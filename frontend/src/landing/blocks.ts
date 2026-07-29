/**
 * Block model for the landing-page builder. A page is an ordered list of
 * blocks (stored as JSON in `LandingPage.blocks`). The same `renderBlock`
 * component drives both the in-app live preview and the static HTML we persist
 * to `LandingPage.html` (via react-dom/server) for the public route.
 */
export type BlockType =
  | "hero"
  | "heading"
  | "text"
  | "image"
  | "features"
  | "cta"
  | "form"
  | "spacer";

export interface HeroBlock {
  id: string;
  type: "hero";
  heading: string;
  subheading: string;
  buttonText: string;
  buttonUrl: string;
  bg: string;
  color: string;
  align: "left" | "center";
}
export interface HeadingBlock {
  id: string;
  type: "heading";
  text: string;
  align: "left" | "center";
}
export interface TextBlock {
  id: string;
  type: "text";
  text: string;
  align: "left" | "center";
}
export interface ImageBlock {
  id: string;
  type: "image";
  url: string;
  alt: string;
  caption: string;
}
export interface FeatureItem {
  id: string;
  icon: string;
  title: string;
  body: string;
}
export interface FeaturesBlock {
  id: string;
  type: "features";
  heading: string;
  items: FeatureItem[];
}
export interface CtaBlock {
  id: string;
  type: "cta";
  heading: string;
  subheading: string;
  buttonText: string;
  buttonUrl: string;
  bg: string;
}
export interface SpacerBlock {
  id: string;
  type: "spacer";
  size: number;
}
export type LeadField = "name" | "email" | "phone" | "message";
export interface FormBlock {
  id: string;
  type: "form";
  heading: string;
  subheading: string;
  fields: LeadField[];
  buttonText: string;
  successCopy: string;
  bg: string;
}

export type Block =
  | HeroBlock
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | FeaturesBlock
  | CtaBlock
  | FormBlock
  | SpacerBlock;

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Hero banner",
  heading: "Heading",
  text: "Text",
  image: "Image",
  features: "Feature grid",
  cta: "Call to action",
  form: "Lead form",
  spacer: "Spacer",
};

let counter = 0;
const uid = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

export function createBlock(type: BlockType): Block {
  switch (type) {
    case "hero":
      return {
        id: uid(),
        type,
        heading: "Your headline goes here",
        subheading: "A short, compelling subheading for the campaign.",
        buttonText: "Get started",
        buttonUrl: "#",
        bg: "#f78d2b",
        color: "#ffffff",
        align: "center",
      };
    case "heading":
      return { id: uid(), type, text: "Section heading", align: "center" };
    case "text":
      return {
        id: uid(),
        type,
        text: "Write a paragraph of supporting copy here to explain the offer.",
        align: "center",
      };
    case "image":
      return { id: uid(), type, url: "", alt: "", caption: "" };
    case "features":
      return {
        id: uid(),
        type,
        heading: "Why choose us",
        items: [
          { id: uid(), icon: "zap", title: "Fast", body: "Quick turnaround on every engagement." },
          { id: uid(), icon: "shield-check", title: "Trusted", body: "Fully licensed and compliant." },
          { id: uid(), icon: "handshake", title: "Personal", body: "A dedicated advisor for your account." },
        ],
      };
    case "cta":
      return {
        id: uid(),
        type,
        heading: "Ready to get started?",
        subheading: "Talk to our team today.",
        buttonText: "Contact us",
        buttonUrl: "#",
        bg: "var(--foreground)",
      };
    case "form":
      return {
        id: uid(),
        type,
        heading: "Get in touch",
        subheading: "Leave your details and we'll get back to you.",
        fields: ["name", "email", "phone", "message"],
        buttonText: "Submit",
        successCopy: "Thanks! We'll be in touch shortly.",
        bg: "#fafafa",
      };
    case "spacer":
      return { id: uid(), type, size: 40 };
  }
}

export function parseBlocks(json: string | null | undefined): Block[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Block[]).map((block) =>
      block.type === "features"
        ? {
            ...block,
            items: block.items.map((item) => ({ ...item, id: item.id || uid() })),
          }
        : block,
    );
  } catch {
    return [];
  }
}
