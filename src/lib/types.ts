/** Domain types shared by the server routes and the browser. */

/* -------------------------------------------------------- Pinterest tool */

export type Product = {
  /** The live storefront link customers click — never the admin URL. */
  sourceUrl: string;
  handle: string;
  title: string;
  description: string;
  /** The SEO meta description, when the store sets one. */
  metaDescription: string;
  vendor: string;
  productType: string;
  tags: string[];
  price: string;
  currency: string;
  available: boolean;
  images: string[];
};

/** One brief, written once, in each network's own register. */
export type PinContent = {
  title: string;
  description: string;
  altText: string;
  hashtags: string[];
  imagePrompt: string;
  instagramCaption: string;
  facebookMessage: string;
};

export type Board = {
  id: string;
  name: string;
  privacy?: string;
};

export type ApiError = { error: string; kind?: string; hint?: string };
