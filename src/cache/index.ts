// cache: semantic query cache (embed question -> pgvector cosine search). Lets
// the orchestrator reuse a near-duplicate question's SQL instead of regenerating.
export {
  cacheLookup,
  cacheStore,
  DEFAULT_SIMILARITY_THRESHOLD,
  type CacheResult,
  type CacheHit,
  type CacheMiss,
  type CacheLookupOptions,
  type CacheStoreOptions,
} from "./cache.js";
