use crate::ifc_adapter::IfcElement;

/// Selector filtering logic based on IfcOpenShell syntax.
/// Initially supports basic type filtering (e.g., "IfcWall").
pub struct Selector {
    query: String,
}

impl Selector {
    pub fn new(query: &str) -> Self {
        Self {
            query: query.trim().to_string(),
        }
    }

    /// Filters a list of elements based on the query.
    pub fn filter(&self, elements: Vec<IfcElement>) -> Vec<IfcElement> {
        if self.query.is_empty() {
            return elements;
        }

        elements.into_iter().filter(|el| self.matches(el)).collect()
    }

    /// Checks if a single element matches the query.
    pub fn matches(&self, el: &IfcElement) -> bool {
        if self.query.is_empty() || self.query == "*" {
            return true;
        }

        // "IfcElement" alias: all elements whose type does NOT start with "IfcFeature"
        if self.query.eq_ignore_ascii_case("IfcElement") {
            return !el
                .metadata
                .ifc_type
                .to_uppercase()
                .starts_with("IFCFEATURE");
        }

        let is_exclusion = self.query.starts_with('!');
        let query_val = if is_exclusion {
            &self.query[1..]
        } else {
            &self.query
        };

        // If it starts with #, treat it as a GUID
        let matched = if query_val.starts_with('#') {
            let guid = &query_val[1..];
            el.metadata.guid == guid
        } else {
            // Pipe-separated alternatives: "IfcBeam|IfcColumn" → match either
            let el_type_upper = el.metadata.ifc_type.to_uppercase();
            query_val.split('|').any(|part| {
                let part = part.trim().to_uppercase();
                if part.ends_with('*') {
                    // Prefix wildcard: "IfcDuct*" → matches IfcDuctSegment, IfcDuctFitting, etc.
                    el_type_upper.starts_with(&part[..part.len() - 1])
                } else {
                    el_type_upper == part
                }
            })
        };

        if is_exclusion { !matched } else { matched }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ifc_adapter::IfcMetadata;
    use parry3d_f64::shape::TriMesh;
    use std::collections::HashMap;

    fn create_mock_element(ifc_type: &str, guid: &str) -> IfcElement {
        let vertices = vec![
            parry3d_f64::math::Vector::new(0.0, 0.0, 0.0),
            parry3d_f64::math::Vector::new(1.0, 0.0, 0.0),
            parry3d_f64::math::Vector::new(0.0, 1.0, 0.0),
        ];
        let indices = vec![[0, 1, 2]];
        IfcElement {
            metadata: IfcMetadata {
                guid: guid.to_string(),
                name: String::new(),
                ifc_type: ifc_type.to_string(),
                description: None,
                object_type: None,
                discipline: "General".to_string(),
                properties: HashMap::new(),
                length_unit: "meter".to_string(),
                source_file: String::new(),
            },
            mesh: TriMesh::new(vertices, indices).expect("Mock mesh should be valid"),
        }
    }

    #[test]
    fn test_basic_type_filtering() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let el2 = create_mock_element("IfcWindow", "guid2");
        let elements = vec![el1, el2];

        let selector = Selector::new("IfcWall");
        let filtered = selector.filter(elements);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].metadata.ifc_type, "IfcWall");
    }

    #[test]
    fn test_exclusion_filtering() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let el2 = create_mock_element("IfcWindow", "guid2");
        let elements = vec![el1, el2];

        let selector = Selector::new("!IfcWall");
        let filtered = selector.filter(elements);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].metadata.ifc_type, "IfcWindow");
    }

    #[test]
    fn test_guid_filtering() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let el2 = create_mock_element("IfcWall", "guid2");
        let elements = vec![el1, el2];

        let selector = Selector::new("#guid1");
        let filtered = selector.filter(elements);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].metadata.guid, "guid1");
    }

    #[test]
    fn test_wildcard_filtering() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let el2 = create_mock_element("IfcWindow", "guid2");
        let elements = vec![el1, el2];

        let selector = Selector::new("*");
        let filtered = selector.filter(elements);

        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_empty_query() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let elements = vec![el1];

        let selector = Selector::new("");
        let filtered = selector.filter(elements);

        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn test_case_insensitivity() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let elements = vec![el1];

        let selector = Selector::new("ifcwall");
        let filtered = selector.filter(elements);

        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn test_selector_ifc_element_alias() {
        let el1 = create_mock_element("IfcWall", "guid1");
        let el2 = create_mock_element("IfcFeatureElementSubtraction", "guid2");
        let el3 = create_mock_element("IfcOpeningElement", "guid3");
        let elements = vec![el1, el2, el3];

        let selector = Selector::new("IfcElement");
        let filtered = selector.filter(elements);

        // Should include IfcWall and IfcOpeningElement but exclude IfcFeatureElement* subtypes
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().any(|e| e.metadata.ifc_type == "IfcWall"));
        assert!(!filtered
            .iter()
            .any(|e| e.metadata.ifc_type == "IfcFeatureElementSubtraction"));
    }
}
