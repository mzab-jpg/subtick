package expo.modules.tangentrssparser

import android.util.Log
import android.util.Xml
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.LinkedHashMap
import java.util.concurrent.Executors
import org.xmlpull.v1.XmlPullParser

private const val CONNECT_TIMEOUT_MS = 15_000
private const val READ_TIMEOUT_MS = 15_000
private const val MAX_CACHED_FEEDS = 16
private const val MAX_PREPARED_ARTICLES = 5 // exactly the five upcoming Reader targets
// Raw XML is cached only when it fits this bounded app-memory allowance. A
// larger legitimate feed remains readable: the active request stream-parses it
// directly to the selected item and deliberately does not retain the full XML.
private const val MAX_CACHEABLE_FEED_BYTES = 5 * 1024 * 1024
private const val LOG_TAG = "TangentRss"

private class CacheLimitReachedException : IOException()
private class ArticleNotFoundException : IOException("Article not found in RSS feed.")
private data class RssItem(val guid: String, val rawHtml: String, val link: String?)

/** Android-only process-memory RSS cache. I/O/XML parsing use one native thread. */
class TangentRssParserModule : Module() {
  // A selected article must never wait behind speculative work. The active lane
  // stays serial; two bounded lookahead workers let a slow publisher feed avoid
  // blocking a later, already-available Reader target.
  private val activeExecutor = Executors.newSingleThreadExecutor { task ->
    Thread(task, "TangentRssActive").apply { isDaemon = true }
  }
  private val preloadExecutor = Executors.newFixedThreadPool(2) { task ->
    Thread(task, "TangentRssPreload").apply { isDaemon = true }
  }
  private val lock = Any()
  // Cache raw XML only. This prevents one parsed copy of every article body from
  // occupying memory while still avoiding repeat publisher downloads.
  private val cache = object : LinkedHashMap<String, ByteArray>(MAX_CACHED_FEEDS, 0.75f, true) {
    override fun removeEldestEntry(entry: MutableMap.MutableEntry<String, ByteArray>?) = size > MAX_CACHED_FEEDS
  }
  private val inFlight = mutableMapOf<String, MutableList<(Result<ByteArray>) -> Unit>>()
  // A large feed cannot retain raw XML, so feed-level cache sharing is not enough.
  // This second single-flight map lets an active request join the exact article
  // already being prepared instead of scanning/downloading the same large feed again.
  private val articleInFlight = mutableMapOf<String, MutableList<(Result<RssItem?>) -> Unit>>()
  // Only exact Reader targets are retained here; unrelated RSS entries are never
  // extracted or held as article bodies.
  private val preparedArticles = object : LinkedHashMap<String, RssItem>(MAX_PREPARED_ARTICLES, 0.75f, true) {
    override fun removeEldestEntry(entry: MutableMap.MutableEntry<String, RssItem>?) = size > MAX_PREPARED_ARTICLES
  }

  private fun articleKey(feedUrl: String, guid: String, articleUrl: String?) = "$feedUrl\u0000$guid\u0000${articleUrl.orEmpty()}"

  private fun debug(message: String) {
    if (BuildConfig.DEBUG) Log.d(LOG_TAG, message)
  }

  override fun definition() = ModuleDefinition {
    Name("TangentRssParser")

    AsyncFunction("preloadFeed") { feedUrl: String, promise: Promise ->
      loadCachedRawFeed(feedUrl, isActive = false) { result -> result.fold(
        { promise.resolve(null) },
        // A feed above the memory-cache allowance is still valid; active loading
        // stream-parses it later. Preloading simply declines to retain it.
        { error -> if (error is CacheLimitReachedException) promise.resolve(null)
          else promise.reject("ERR_RSS_FETCH", error.message ?: "Unable to load RSS feed", error) }
      ) }
    }

    AsyncFunction("prepareArticle") { feedUrl: String, guid: String, articleUrl: String?, promise: Promise ->
      prepareSelectedArticle(feedUrl, guid, articleUrl) { result -> result.fold(
        { promise.resolve(null) },
        { error -> promise.reject("ERR_RSS_FETCH", error.message ?: "Unable to prepare RSS article", error) }
      ) }
    }

    AsyncFunction("findArticle") { feedUrl: String, guid: String, articleUrl: String?, promise: Promise ->
      findSelectedArticle(feedUrl, guid, articleUrl) { result -> result.fold(
        { item -> promise.resolve(item?.let { mapOf("guid" to it.guid, "rawHtml" to it.rawHtml, "link" to it.link) }) },
        { error -> promise.reject("ERR_RSS_FETCH", error.message ?: "Unable to load RSS feed", error) }
      ) }
    }

    AsyncFunction("clearCache") { promise: Promise ->
      synchronized(lock) { cache.clear(); preparedArticles.clear() }
      promise.resolve(null)
    }

    OnDestroy {
      activeExecutor.shutdownNow()
      preloadExecutor.shutdownNow()
      synchronized(lock) { cache.clear(); preparedArticles.clear(); inFlight.clear(); articleInFlight.clear() }
    }
  }

  private fun loadCachedRawFeed(feedUrl: String, isActive: Boolean, callback: (Result<ByteArray>) -> Unit) {
    synchronized(lock) {
      cache[feedUrl]?.let { callback(Result.success(it)); return }
      inFlight[feedUrl]?.let { it.add(callback); return }
      debug("queued ${if (isActive) "active" else "preload"} raw feed: ${URI(feedUrl).host}")
      inFlight[feedUrl] = mutableListOf(callback)
    }
    val executor = if (isActive) activeExecutor else preloadExecutor
    executor.execute {
      val startedAt = System.currentTimeMillis()
      val result = runCatching { downloadCacheableRawFeed(feedUrl) }
      result.onSuccess { raw -> debug("raw feed cached (${raw.size} bytes) in ${System.currentTimeMillis() - startedAt}ms: ${URI(feedUrl).host}") }
      result.onFailure { error -> debug("raw feed not cached in ${System.currentTimeMillis() - startedAt}ms: ${URI(feedUrl).host} (${error.message ?: "above cache allowance"})") }
      val callbacks: List<(Result<ByteArray>) -> Unit>
      synchronized(lock) {
        if (result.isSuccess) cache[feedUrl] = result.getOrThrow()
        callbacks = inFlight.remove(feedUrl) ?: emptyList()
      }
      callbacks.forEach { it(result) }
    }
  }

  private fun prepareSelectedArticle(feedUrl: String, guid: String, articleUrl: String?, callback: (Result<Unit>) -> Unit) {
    val key = articleKey(feedUrl, guid, articleUrl)
    synchronized(lock) {
      if (preparedArticles.containsKey(key)) {
        callback(Result.success(Unit))
        return
      }
    }

    resolveArticleSingleFlight(feedUrl, guid, articleUrl, isActive = false) { result ->
      result.fold(
        onSuccess = { item ->
          if (item == null) {
            callback(Result.failure(ArticleNotFoundException()))
          } else {
            synchronized(lock) { preparedArticles[key] = item }
            debug("prepared exact upcoming article: ${URI(feedUrl).host}")
            callback(Result.success(Unit))
          }
        },
        onFailure = { error -> callback(Result.failure(error)) }
      )
    }
  }

  private fun findSelectedArticle(feedUrl: String, guid: String, articleUrl: String?, callback: (Result<RssItem?>) -> Unit) {
    val key = articleKey(feedUrl, guid, articleUrl)
    synchronized(lock) {
      preparedArticles.remove(key)?.let {
        // Consume the article as it becomes current. This leaves four future
        // targets; the rolling buffer then adds exactly one new fifth target.
        debug("prepared article hit: ${URI(feedUrl).host}")
        callback(Result.success(it))
        return
      }
    }
    resolveArticleSingleFlight(feedUrl, guid, articleUrl, isActive = true) { result ->
      // If this active request joined a background preparation, its callback may
      // run after the preloader stored the body. The active Reader consumes it.
      synchronized(lock) { preparedArticles.remove(key) }
      callback(result)
    }
  }

  private fun resolveArticleSingleFlight(feedUrl: String, guid: String, articleUrl: String?, isActive: Boolean, callback: (Result<RssItem?>) -> Unit) {
    val key = articleKey(feedUrl, guid, articleUrl)
    synchronized(lock) {
      articleInFlight[key]?.let {
        debug("joined exact ${if (isActive) "active" else "preload"} article: ${URI(feedUrl).host}")
        it.add(callback)
        return
      }
      articleInFlight[key] = mutableListOf(callback)
    }

    resolveArticle(feedUrl, guid, articleUrl, isActive) { result ->
      val callbacks: List<(Result<RssItem?>) -> Unit>
      synchronized(lock) { callbacks = articleInFlight.remove(key) ?: emptyList() }
      callbacks.forEach { it(result) }
    }
  }

  private fun resolveArticle(feedUrl: String, guid: String, articleUrl: String?, isActive: Boolean, callback: (Result<RssItem?>) -> Unit) {
    val executor = if (isActive) activeExecutor else preloadExecutor
    val cachedRaw = synchronized(lock) { cache[feedUrl] }
    if (cachedRaw != null) {
      executor.execute { callback(runCatching { findItemInFeed(cachedRaw.inputStream(), guid, articleUrl) }) }
      return
    }

    // Obtain reusable raw XML where it fits. Above the allowance, stream the
    // legitimate feed directly to this one requested article and retain nothing.
    loadCachedRawFeed(feedUrl, isActive) { rawResult -> rawResult.fold(
      { raw -> executor.execute { callback(runCatching { findItemInFeed(raw.inputStream(), guid, articleUrl) }) } },
      { error ->
        if (error is CacheLimitReachedException) {
          executor.execute { callback(runCatching { findItemFromNetwork(feedUrl, guid, articleUrl) }) }
        } else callback(Result.failure(error))
      }
    ) }
  }

  private fun openConnection(feedUrl: String): HttpURLConnection {
    val uri = URI(feedUrl)
    require(uri.scheme.equals("https", true) && !uri.host.isNullOrBlank()) { "RSS feed must use HTTPS." }
    return (URL(feedUrl).openConnection() as HttpURLConnection).apply {
      connectTimeout = CONNECT_TIMEOUT_MS; readTimeout = READ_TIMEOUT_MS; instanceFollowRedirects = true; requestMethod = "GET"
      setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml")
      setRequestProperty("User-Agent", "TangentRSS/1.0")
    }
  }

  private fun downloadCacheableRawFeed(feedUrl: String): ByteArray {
    val connection = openConnection(feedUrl)
    try {
      require(connection.responseCode in 200..299) { "RSS server returned HTTP ${connection.responseCode}." }
      if (connection.contentLengthLong > MAX_CACHEABLE_FEED_BYTES.toLong()) throw CacheLimitReachedException()
      BufferedInputStream(connection.inputStream).use { input ->
        val output = ByteArrayOutputStream(); val buffer = ByteArray(8 * 1024)
        while (true) {
          val count = input.read(buffer); if (count == -1) break
          if (output.size() + count > MAX_CACHEABLE_FEED_BYTES) throw CacheLimitReachedException()
          output.write(buffer, 0, count)
        }
        return output.toByteArray()
      }
    } finally { connection.disconnect() }
  }

  private fun findItemFromNetwork(feedUrl: String, guid: String, articleUrl: String?): RssItem? {
    val connection = openConnection(feedUrl)
    try {
      require(connection.responseCode in 200..299) { "RSS server returned HTTP ${connection.responseCode}." }
      return BufferedInputStream(connection.inputStream).use { findItemInFeed(it, guid, articleUrl) }
    } finally { connection.disconnect() }
  }

  private fun findItemInFeed(input: InputStream, guid: String, articleUrl: String?): RssItem? {
    val parser = Xml.newPullParser(); parser.setInput(input, "UTF-8")
    while (parser.eventType != XmlPullParser.END_DOCUMENT) {
      if (parser.eventType == XmlPullParser.START_TAG && (parser.name == "item" || parser.name == "entry")) {
        val item = parseItem(parser)
        if (item != null && (item.guid == guid || (articleUrl != null && item.link == articleUrl))) return item
      }
      parser.next()
    }
    return null
  }

  private fun parseItem(parser: XmlPullParser): RssItem? {
    val itemDepth = parser.depth
    var guid = ""
    var link: String? = null
    var content = ""
    var description = ""

    while (parser.next() != XmlPullParser.END_DOCUMENT) {
      if (parser.eventType == XmlPullParser.END_TAG && parser.depth == itemDepth) break
      if (parser.eventType != XmlPullParser.START_TAG) continue

      val name = parser.name ?: continue
      val prefix = parser.prefix ?: ""
      when {
        name == "guid" || name == "id" -> guid = readText(parser)
        name == "link" -> {
          val href = parser.getAttributeValue(null, "href")
          val rel = parser.getAttributeValue(null, "rel")
          if (href != null && (rel == null || rel == "alternate")) link = href
          else if (href == null) link = readText(parser)
        }
        (prefix == "content" && name == "encoded") || name == "encoded" || name == "content" -> {
          val candidate = readText(parser)
          if (candidate.isNotBlank()) content = candidate
        }
        name == "description" || name == "summary" -> {
          val candidate = readText(parser)
          if (candidate.isNotBlank()) description = candidate
        }
      }
    }

    val resolvedGuid = guid.ifBlank { link.orEmpty() }
    return if (resolvedGuid.isBlank()) null else RssItem(resolvedGuid, content.ifBlank { description }, link)
  }

  private fun readText(parser: XmlPullParser): String {
    val output = ByteArrayOutputStream()
    val startDepth = parser.depth
    while (parser.next() != XmlPullParser.END_DOCUMENT) {
      when (parser.eventType) {
        XmlPullParser.TEXT, XmlPullParser.CDSECT, XmlPullParser.ENTITY_REF -> output.write((parser.text ?: "").toByteArray())
        XmlPullParser.END_TAG -> if (parser.depth == startDepth) return output.toString(Charsets.UTF_8.name())
      }
    }
    return output.toString(Charsets.UTF_8.name())
  }
}

