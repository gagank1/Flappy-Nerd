use wasm_bindgen::JsCast;
use web_sys::{Document, HtmlDivElement};

pub struct Hud {
    root: HtmlDivElement,
    fps: HtmlDivElement,
    score: HtmlDivElement,
    status: HtmlDivElement,
}

impl Hud {
    pub fn new(document: &Document) -> Result<Self, wasm_bindgen::JsValue> {
        let body = document
            .body()
            .ok_or_else(|| wasm_bindgen::JsValue::from_str("document has no body"))?;

        let root: HtmlDivElement = document
            .create_element("div")?
            .dyn_into()
            .map_err(|_| wasm_bindgen::JsValue::from_str("failed to create hud"))?;
        root.set_class_name("hud-root");
        set_style(
            &root,
            "position:fixed;top:16px;left:16px;color:white;font-family:'Inter',sans-serif;font-size:16px;pointer-events:none;text-shadow:0 0 6px rgba(0,0,0,0.45);z-index:1000;",
        );

        let fps: HtmlDivElement = document.create_element("div")?.dyn_into()?;
        fps.set_inner_text("FPS: --");
        set_style(&fps, "margin-bottom:4px;font-weight:600;");

        let score: HtmlDivElement = document.create_element("div")?.dyn_into()?;
        score.set_inner_text("Score: 0");
        set_style(&score, "margin-bottom:4px;");

        let status: HtmlDivElement = document.create_element("div")?.dyn_into()?;
        status.set_inner_text("Tap or press Space to start");
        set_style(&status, "max-width:320px;line-height:1.4;");

        root.append_child(&fps)?;
        root.append_child(&score)?;
        root.append_child(&status)?;
        body.append_child(&root)?;

        Ok(Self {
            root,
            fps,
            score,
            status,
        })
    }

    pub fn set_fps(&self, fps: f32) {
        self.fps
            .set_inner_text(&format!("FPS: {:>3.0}", fps.round().clamp(0.0, 999.0)));
    }

    pub fn set_score(&self, score: u32, best: u32) {
        if best > 0 {
            self.score
                .set_inner_text(&format!("Score: {}  (best {})", score, best));
        } else {
            self.score.set_inner_text(&format!("Score: {}", score));
        }
    }

    pub fn set_status(&self, text: &str) {
        self.status.set_inner_text(text);
        if text.is_empty() {
            set_style(
                &self.status,
                "opacity:0;transition:opacity 0.2s ease;max-width:320px;line-height:1.4;",
            );
        } else {
            set_style(
                &self.status,
                "opacity:1;transition:opacity 0.2s ease;max-width:320px;line-height:1.4;",
            );
        }
    }

    pub fn set_error(&self, text: &str) {
        self.status.set_inner_text(text);
        set_style(
            &self.status,
            "color:#ff8080;font-weight:600;max-width:320px;line-height:1.4;",
        );
        set_style(
            &self.root,
            "position:fixed;top:16px;left:16px;color:white;font-family:'Inter',sans-serif;font-size:16px;pointer-events:none;text-shadow:0 0 6px rgba(0,0,0,0.45);z-index:1000;",
        );
    }
}

fn set_style(element: &HtmlDivElement, css: &str) {
    element.style().set_css_text(css);
}
