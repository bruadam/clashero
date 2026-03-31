use anyhow::Result;
use chrono::Utc;
use quick_xml::Writer;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Write};
use std::path::Path;
use uuid::Uuid;
use zip::ZipWriter;
use zip::write::FileOptions;

/// Maps to IfcOpenShell ClashType values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClashType {
    Hard,
    Soft,
    Clearance,
}

impl std::fmt::Display for ClashType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClashType::Hard => write!(f, "hard"),
            ClashType::Soft => write!(f, "soft"),
            ClashType::Clearance => write!(f, "clearance"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClashInfo {
    // Clash identity
    pub clash_id: String,
    pub clash_set_name: String,

    // Element A
    pub guid_a: String,
    pub name_a: String,
    pub ifc_type_a: String,
    pub description_a: Option<String>,
    pub discipline_a: String,
    pub source_file_a: String,
    pub properties_a: HashMap<String, String>,

    // Element B
    pub guid_b: String,
    pub name_b: String,
    pub ifc_type_b: String,
    pub description_b: Option<String>,
    pub discipline_b: String,
    pub source_file_b: String,
    pub properties_b: HashMap<String, String>,

    // Geometry
    pub p1: [f64; 3],
    pub p2: [f64; 3],
    pub distance: f64,
    pub penetration_depth: f64,
    pub penetration_volume: f64,
    pub clash_type: ClashType,

    // BCF camera
    pub camera_eye: Option<[f64; 3]>,

    // AI narrative
    pub description: String,
}

pub fn generate_bcf<P: AsRef<Path>>(path: P, clashes: &[ClashInfo]) -> Result<()> {
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options: FileOptions<'_, ()> = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o755);

    // 1. bcf.version
    zip.start_file("bcf.version", options)?;
    zip.write_all(b"VersionId=\"2.1\"")?;

    // 2. project.bcfp
    zip.start_file("project.bcfp", options)?;
    let mut project_writer = Writer::new(Cursor::new(Vec::new()));
    project_writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
    let mut project_start = BytesStart::new("ProjectExtension");
    project_start.push_attribute(("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"));
    project_writer.write_event(Event::Start(project_start))?;
    project_writer.write_event(Event::Start(BytesStart::new("Project")))?;
    project_writer.write_event(Event::Start(BytesStart::new("Name")))?;
    project_writer.write_event(Event::Text(BytesText::new("Clash Detection Project")))?;
    project_writer.write_event(Event::End(BytesEnd::new("Name")))?;

    project_writer.write_event(Event::End(BytesEnd::new("Project")))?;
    project_writer.write_event(Event::End(BytesEnd::new("ProjectExtension")))?;
    zip.write_all(&project_writer.into_inner().into_inner())?;

    // 3. For each clash, create a topic folder
    for clash in clashes {
        let topic_id = Uuid::new_v4().to_string();
        let topic_dir = format!("{}/", topic_id);

        let title = format!(
            "{}/{} and {}/{}",
            clash.ifc_type_a, clash.name_a, clash.ifc_type_b, clash.name_b
        );

        let priority = if clash.penetration_depth > 0.1 {
            "Critical"
        } else {
            "Normal"
        };

        let verb = match clash.clash_type {
            ClashType::Hard => "penetrates",
            ClashType::Soft => "approaches within tolerance of",
            ClashType::Clearance => "violates clearance of",
        };

        // markup.bcf
        zip.start_file(format!("{}markup.bcf", topic_dir), options)?;
        let mut markup_writer = Writer::new(Cursor::new(Vec::new()));
        markup_writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

        let markup_start = BytesStart::new("Markup");
        markup_writer.write_event(Event::Start(markup_start))?;

        let mut topic_start = BytesStart::new("Topic");
        topic_start.push_attribute(("Guid", topic_id.as_str()));
        topic_start.push_attribute(("TopicType", "Clash"));
        topic_start.push_attribute(("TopicStatus", "Open"));
        markup_writer.write_event(Event::Start(topic_start))?;

        markup_writer.write_event(Event::Start(BytesStart::new("Title")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&title)))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Title")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("Priority")))?;
        markup_writer.write_event(Event::Text(BytesText::new(priority)))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Priority")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("CreationDate")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&Utc::now().to_rfc3339())))?;
        markup_writer.write_event(Event::End(BytesEnd::new("CreationDate")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("CreationAuthor")))?;
        markup_writer.write_event(Event::Text(BytesText::new("Clashero")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("CreationAuthor")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("Description")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&clash.description)))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Description")))?;

        // Labels
        markup_writer.write_event(Event::Start(BytesStart::new("Labels")))?;
        for label in &[
            clash.discipline_a.as_str(),
            clash.discipline_b.as_str(),
            clash.clash_type.to_string().as_str(),
            clash.clash_set_name.as_str(),
        ] {
            markup_writer.write_event(Event::Start(BytesStart::new("Label")))?;
            markup_writer.write_event(Event::Text(BytesText::new(label)))?;
            markup_writer.write_event(Event::End(BytesEnd::new("Label")))?;
        }
        markup_writer.write_event(Event::End(BytesEnd::new("Labels")))?;

        markup_writer.write_event(Event::End(BytesEnd::new("Topic")))?;

        // BIMSnippet with JSON clash data
        let mut snippet_start = BytesStart::new("BIMSnippet");
        snippet_start.push_attribute(("SnippetType", "JSON"));
        snippet_start.push_attribute(("IsExternal", "false"));
        markup_writer.write_event(Event::Start(snippet_start))?;
        markup_writer.write_event(Event::Start(BytesStart::new("Reference")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&format!(
            "{}/clash_data.json",
            topic_id
        ))))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Reference")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("BIMSnippet")))?;

        // Comment with AI narrative
        markup_writer.write_event(Event::Start(BytesStart::new("Comment")))?;
        let comment_guid = Uuid::new_v4().to_string();
        markup_writer.write_event(Event::Start(BytesStart::new("Guid")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&comment_guid)))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Guid")))?;
        markup_writer.write_event(Event::Start(BytesStart::new("Date")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&Utc::now().to_rfc3339())))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Date")))?;
        markup_writer.write_event(Event::Start(BytesStart::new("Author")))?;
        markup_writer.write_event(Event::Text(BytesText::new("Clashero")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Author")))?;
        let comment_text = format!(
            "[{}] {} clash — {}/{} ({}) {} {}/{} ({}).\n  \
             Penetration depth: {:.3} m | Overlap volume ≈ {:.4} m³.\n  \
             Discipline A: {} | Source: {}\n  \
             Discipline B: {} | Source: {}",
            clash.clash_set_name,
            clash.clash_type,
            clash.ifc_type_a, clash.name_a, clash.guid_a,
            verb,
            clash.ifc_type_b, clash.name_b, clash.guid_b,
            clash.penetration_depth,
            clash.penetration_volume,
            clash.discipline_a, clash.source_file_a,
            clash.discipline_b, clash.source_file_b,
        );
        markup_writer.write_event(Event::Start(BytesStart::new("Comment")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&comment_text)))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Comment")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Comment")))?;

        markup_writer.write_event(Event::End(BytesEnd::new("Markup")))?;
        zip.write_all(&markup_writer.into_inner().into_inner())?;

        // clash_data.json
        zip.start_file(format!("{}clash_data.json", topic_dir), options)?;
        zip.write_all(serde_json::to_string_pretty(clash)?.as_bytes())?;

        // viewpoint.bcfv
        let viewpoint_id = Uuid::new_v4().to_string();
        zip.start_file(format!("{}{}.bcfv", topic_dir, viewpoint_id), options)?;
        let mut bcfv_writer = Writer::new(Cursor::new(Vec::new()));
        bcfv_writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("VisualizationInfo")))?;

        // Components with visibility, selection and coloring
        bcfv_writer.write_event(Event::Start(BytesStart::new("Components")))?;

        // Visibility with exceptions (show only clashing elements)
        let mut visibility_start = BytesStart::new("Visibility");
        visibility_start.push_attribute(("DefaultVisibility", "false"));
        bcfv_writer.write_event(Event::Start(visibility_start))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Exceptions")))?;
        for guid in &[&clash.guid_a, &clash.guid_b] {
            let mut comp = BytesStart::new("Component");
            comp.push_attribute(("IfcGuid", guid.as_str()));
            bcfv_writer.write_event(Event::Empty(comp))?;
        }
        bcfv_writer.write_event(Event::End(BytesEnd::new("Exceptions")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Visibility")))?;

        // Selection
        let selection_start = BytesStart::new("Selection");
        bcfv_writer.write_event(Event::Start(selection_start))?;
        for guid in &[&clash.guid_a, &clash.guid_b] {
            let mut component_start = BytesStart::new("Component");
            component_start.push_attribute(("IfcGuid", guid.as_str()));
            bcfv_writer.write_event(Event::Empty(component_start))?;
        }
        bcfv_writer.write_event(Event::End(BytesEnd::new("Selection")))?;

        // Coloring (red highlight)
        bcfv_writer.write_event(Event::Start(BytesStart::new("Coloring")))?;
        let mut color_start = BytesStart::new("Color");
        color_start.push_attribute(("Color", "FF0000"));
        bcfv_writer.write_event(Event::Start(color_start))?;
        for guid in &[&clash.guid_a, &clash.guid_b] {
            let mut comp = BytesStart::new("Component");
            comp.push_attribute(("IfcGuid", guid.as_str()));
            bcfv_writer.write_event(Event::Empty(comp))?;
        }
        bcfv_writer.write_event(Event::End(BytesEnd::new("Color")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Coloring")))?;

        bcfv_writer.write_event(Event::End(BytesEnd::new("Components")))?;

        bcfv_writer.write_event(Event::Start(BytesStart::new("PerspectiveCamera")))?;

        let (eye, dir) = if let Some(eye) = clash.camera_eye {
            let d = [
                clash.p1[0] - eye[0],
                clash.p1[1] - eye[1],
                clash.p1[2] - eye[2],
            ];
            let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
            let dir = if len > 0.0 {
                [d[0] / len, d[1] / len, d[2] / len]
            } else {
                [0.0, 0.0, -1.0]
            };
            (eye, dir)
        } else {
            (
                [
                    clash.p1[0] + 5.0,
                    clash.p1[1] + 5.0,
                    clash.p1[2] + 5.0,
                ],
                [-0.57735, -0.57735, -0.57735],
            )
        };

        bcfv_writer.write_event(Event::Start(BytesStart::new("CameraViewPoint")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("X")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new(&eye[0].to_string())))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("X")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Y")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new(&eye[1].to_string())))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Y")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Z")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new(&eye[2].to_string())))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Z")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("CameraViewPoint")))?;

        bcfv_writer.write_event(Event::Start(BytesStart::new("CameraDirection")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("X")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new(&dir[0].to_string())))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("X")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Y")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new(&dir[1].to_string())))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Y")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Z")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new(&dir[2].to_string())))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Z")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("CameraDirection")))?;

        bcfv_writer.write_event(Event::Start(BytesStart::new("CameraUpVector")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("X")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new("0")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("X")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Y")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new("1")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Y")))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("Z")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new("0")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("Z")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("CameraUpVector")))?;

        bcfv_writer.write_event(Event::Start(BytesStart::new("FieldOfView")))?;
        bcfv_writer.write_event(Event::Text(BytesText::new("45")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("FieldOfView")))?;

        bcfv_writer.write_event(Event::End(BytesEnd::new("PerspectiveCamera")))?;
        bcfv_writer.write_event(Event::End(BytesEnd::new("VisualizationInfo")))?;
        zip.write_all(&bcfv_writer.into_inner().into_inner())?;
    }

    zip.finish()?;
    Ok(())
}

/// Serialises a list of ClashInfo records as a JSON array to the given path.
pub fn generate_json<P: AsRef<Path>>(path: P, clashes: &[ClashInfo]) -> Result<()> {
    let json = serde_json::to_string_pretty(clashes)?;
    std::fs::write(path, json)?;
    Ok(())
}
