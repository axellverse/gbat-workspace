/**
 * Post styles. One choice steers both halves of a generation: the words the
 * model writes and the way the creative is drawn, so a "Casual" post never
 * comes back with a hard-sell headline over a discount badge.
 *
 * Pure data — imported by the browser composer and the server prompt alike.
 */

export type PostStyleId =
  | "promotional"
  | "feature"
  | "casual"
  | "lifestyle"
  | "problem-solution"
  | "social-proof"
  | "minimal"
  | "launch";

/** How the canvas draws this style. */
export type ImageTreatment = {
  /** 0–1: how hard the bottom gradient darkens the photo. */
  scrim: number;
  showPrice: boolean;
  showCta: boolean;
  showBrand: boolean;
  /** Short corner flag, e.g. SALE or NEW. Empty for none. */
  badge: string;
  headlineCase: "none" | "upper";
  /** Multiplier on the headline size. */
  headlineScale: number;
  /** A short accent rule above the headline. */
  accentRule: boolean;
};

export type PostStyle = {
  id: PostStyleId;
  label: string;
  blurb: string;
  defaultCta: string;
  /** Dropped into the prompt so every channel's copy shares the same angle. */
  copyGuidance: string;
  image: ImageTreatment;
};

export const POST_STYLES: PostStyle[] = [
  {
    id: "promotional",
    label: "Promotional",
    blurb: "Offer-led. Leads with the deal and pushes the click.",
    defaultCta: "Shop the deal",
    copyGuidance:
      "Lead with the offer and the saving. Make the value explicit and give a concrete reason to act now, but " +
      "only use discounts, prices or deadlines that appear in the supplied product data — never invent one.",
    image: {
      scrim: 0.9,
      showPrice: true,
      showCta: true,
      showBrand: true,
      badge: "SALE",
      headlineCase: "upper",
      headlineScale: 1.05,
      accentRule: false,
    },
  },
  {
    id: "feature",
    label: "Feature focused",
    blurb: "Leads with what it is and what it does.",
    defaultCta: "See the details",
    copyGuidance:
      "Lead with the two or three concrete features that matter most — materials, fit, capacity, compatibility. " +
      "Prefer specifics over adjectives, and translate each feature into the benefit the buyer feels.",
    image: {
      scrim: 0.82,
      showPrice: true,
      showCta: true,
      showBrand: true,
      badge: "",
      headlineCase: "none",
      headlineScale: 0.92,
      accentRule: true,
    },
  },
  {
    id: "casual",
    label: "Casual post",
    blurb: "Conversational, like a friend recommending it.",
    defaultCta: "Take a look",
    copyGuidance:
      "Write like a person, not a brand. Short sentences, plain words, a little warmth. No superlatives, no " +
      "exclamation stacks, and no sales language — this should read like a recommendation, not an advert.",
    image: {
      scrim: 0.62,
      showPrice: false,
      showCta: true,
      showBrand: false,
      badge: "",
      headlineCase: "none",
      headlineScale: 0.88,
      accentRule: false,
    },
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    blurb: "Aspirational scene. Sells the feeling, not the spec.",
    defaultCta: "Shop the look",
    copyGuidance:
      "Put the reader in a scene where they are already using it — the moment, the light, the room, the season. " +
      "Sell the feeling rather than the specification, and keep the product mention light.",
    image: {
      scrim: 0.55,
      showPrice: false,
      showCta: true,
      showBrand: true,
      badge: "",
      headlineCase: "none",
      headlineScale: 1.0,
      accentRule: false,
    },
  },
  {
    id: "problem-solution",
    label: "Problem → solution",
    blurb: "Names the annoyance first, then the fix.",
    defaultCta: "Fix it now",
    copyGuidance:
      "Open by naming a specific, everyday frustration this product removes — one the supplied data actually " +
      "supports. Then show the fix in a sentence. Do not exaggerate the problem or imply a health claim.",
    image: {
      scrim: 0.86,
      showPrice: false,
      showCta: true,
      showBrand: true,
      badge: "",
      headlineCase: "none",
      headlineScale: 0.95,
      accentRule: true,
    },
  },
  {
    id: "social-proof",
    label: "Social proof",
    blurb: "Leans on popularity and what buyers say.",
    defaultCta: "See why",
    copyGuidance:
      "Lead with popularity or reception — best-seller, restocked, widely loved — but ONLY if the supplied data " +
      "supports it. If there is no rating, review count or sales signal in the data, write about the product's " +
      "most persuasive concrete quality instead and make no popularity claim at all.",
    image: {
      scrim: 0.84,
      showPrice: true,
      showCta: true,
      showBrand: true,
      badge: "LOVED",
      headlineCase: "none",
      headlineScale: 0.95,
      accentRule: false,
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    blurb: "Product first. Almost nothing on the image.",
    defaultCta: "",
    copyGuidance:
      "Be spare. One clean line about what it is, one about why it is good. No filler, no hype, no emoji.",
    image: {
      scrim: 0.35,
      showPrice: false,
      showCta: false,
      showBrand: true,
      badge: "",
      headlineCase: "none",
      headlineScale: 0.8,
      accentRule: false,
    },
  },
  {
    id: "launch",
    label: "New arrival",
    blurb: "Announcement energy for something just landed.",
    defaultCta: "Shop new in",
    copyGuidance:
      "Frame it as newly arrived and worth a look before it goes. Keep the excitement genuine and specific — " +
      "say what is new about it rather than simply shouting that it is new.",
    image: {
      scrim: 0.88,
      showPrice: true,
      showCta: true,
      showBrand: true,
      badge: "NEW IN",
      headlineCase: "upper",
      headlineScale: 1.0,
      accentRule: true,
    },
  },
];

export const DEFAULT_STYLE_ID: PostStyleId = "promotional";

export function getStyle(id: string | undefined): PostStyle {
  return POST_STYLES.find((style) => style.id === id) ?? POST_STYLES[0];
}
