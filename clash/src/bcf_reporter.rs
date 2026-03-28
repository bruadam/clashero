use anyhow::Result;
use chrono::Utc;
use quick_xml::Writer;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use std::fs::File;
use std::io::{Cursor, Write};
use std::path::Path;
use uuid::Uuid;
use zip::ZipWriter;
use zip::write::FileOptions;

pub struct ClashInfo {
    pub guid_a: String,
    pub guid_b: String,
    pub description: String,
    pub position: [f64; 3],
    pub camera_eye: Option<[f64; 3]>,
}

pub fn generate_bcf<P: AsRef<Path>>(path: P, clashes: &[ClashInfo]) -> Result<()> {
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
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
        markup_writer.write_event(Event::Text(BytesText::new(&format!(
            "Clash between {} and {}",
            clash.guid_a, clash.guid_b
        ))))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Title")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("CreationDate")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&Utc::now().to_rfc3339())))?;
        markup_writer.write_event(Event::End(BytesEnd::new("CreationDate")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("CreationAuthor")))?;
        markup_writer.write_event(Event::Text(BytesText::new("Clashero")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("CreationAuthor")))?;

        markup_writer.write_event(Event::Start(BytesStart::new("Description")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&clash.description)))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Description")))?;

        markup_writer.write_event(Event::End(BytesEnd::new("Topic")))?;

        // BIMSnippet for GUIDs
        markup_writer.write_event(Event::Start(BytesStart::new("BIMSnippet")))?;
        markup_writer.write_event(Event::Start(BytesStart::new("SnippetType")))?;
        markup_writer.write_event(Event::Text(BytesText::new("ClashGUIDs")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("SnippetType")))?;
        markup_writer.write_event(Event::Start(BytesStart::new("Reference")))?;
        markup_writer.write_event(Event::Text(BytesText::new(&format!(
            "{},{}",
            clash.guid_a, clash.guid_b
        ))))?;
        markup_writer.write_event(Event::End(BytesEnd::new("Reference")))?;
        markup_writer.write_event(Event::End(BytesEnd::new("BIMSnippet")))?;

        markup_writer.write_event(Event::End(BytesEnd::new("Markup")))?;
        zip.write_all(&markup_writer.into_inner().into_inner())?;

        // viewpoint.bcfv
        let viewpoint_id = Uuid::new_v4().to_string();
        zip.start_file(format!("{}{}.bcfv", topic_dir, viewpoint_id), options)?;
        let mut bcfv_writer = Writer::new(Cursor::new(Vec::new()));
        bcfv_writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
        bcfv_writer.write_event(Event::Start(BytesStart::new("VisualizationInfo")))?;

        bcfv_writer.write_event(Event::Start(BytesStart::new("Components")))?;

        let selection_start = BytesStart::new("Selection");
        bcfv_writer.write_event(Event::Start(selection_start))?;
        for guid in &[&clash.guid_a, &clash.guid_b] {
            let mut component_start = BytesStart::new("Component");
            component_start.push_attribute(("IfcGuid", guid.as_str()));
            bcfv_writer.write_event(Event::Empty(component_start))?;
        }
        bcfv_writer.write_event(Event::End(BytesEnd::new("Selection")))?;

        bcfv_writer.write_event(Event::End(BytesEnd::new("Components")))?;

        bcfv_writer.write_event(Event::Start(BytesStart::new("PerspectiveCamera")))?;

        let (eye, dir) = if let Some(eye) = clash.camera_eye {
            let d = [
                clash.position[0] - eye[0],
                clash.position[1] - eye[1],
                clash.position[2] - eye[2],
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
                    clash.position[0] + 5.0,
                    clash.position[1] + 5.0,
                    clash.position[2] + 5.0,
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
