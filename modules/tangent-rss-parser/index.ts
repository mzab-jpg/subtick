import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeRssArticle {
  guid: string;
  rawHtml: string;
  link?: string;
}

interface TangentRssParserNativeModule {
  /** Low-priority raw-feed warming for repeat publisher reuse. */
  preloadFeed(feedUrl: string): Promise<void>;
  /** Low-priority preparation of one exact upcoming Reader article body. */
  prepareArticle(feedUrl: string, guid: string, articleUrl?: string): Promise<void>;
  /** High-priority request for the article the person selected now. */
  findArticle(feedUrl: string, guid: string, articleUrl?: string): Promise<NativeRssArticle | null>;
  clearCache(): Promise<void>;
}

/**
 * Null in Expo Go and in development APKs built before this local module was
 * added. Callers use the existing JavaScript parser as their safe fallback.
 */
export default requireOptionalNativeModule<TangentRssParserNativeModule>('TangentRssParser');
