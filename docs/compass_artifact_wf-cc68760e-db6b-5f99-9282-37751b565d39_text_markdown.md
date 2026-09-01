# Diagnosing and Fixing High Latency in Node.js HTTP APIs: A 2024–2025 Playbook

## TL;DR
- **The single biggest latency win is almost never the framework — it's eliminating event-loop blocking and adding connection pooling + caching.** A blocked event loop (sync crypto, huge JSON, unbounded loops) stalls *every* concurrent request; per official fastify/benchmarks data, switching Express→Fastify buys roughly 1.8x framework throughput, but pooling and caching routinely cut p95 latency by 50–95% because network/DB round-trips dominate real workloads.
- **Work in priority order:** (1) profile to find the real hot path (clinic.js/0x/`--prof`), (2) unblock the event loop and offload CPU work to Worker Threads, (3) parallelize independent awaits, (4) pool DB and HTTP connections + enable keep-alive, (5) cache (LRU → Redis → HTTP/CDN), (6) compress and stream, (7) tune production config (NODE_ENV, cluster, UV_THREADPOOL_SIZE, V8 heap).
- **Measure before and after every change** with a fixed load (autocannon `-c 100`) and track p50/p95/p99 latency + RPS; a flag or rewrite that wins a synthetic benchmark can lose on real traffic.

## Key Findings

1. **Event-loop blocking is the #1 latency killer.** Node runs your JavaScript on one thread; any synchronous operation over ~10 ms (large JSON parse, sync crypto, regex on user input, big array loops, sync fs) freezes all requests. Keep synchronous work under ~10 ms and yield with `setImmediate` for long loops.
2. **Framework choice matters less than people think for real APIs.** Official fastify/benchmarks (Node v24.20.0, run Sept 1 2026): Fastify 5.12.1 ≈ 66,507 req/s vs Express 5.2.1 ≈ 36,487 req/s — Fastify is ~1.8x faster on framework overhead. But that overhead is only visible on trivial endpoints; once a DB or external call is involved, that call dominates.
3. **Connection pooling is, per Grizzly Peak Software's "Connection Pooling in Node.js," "the single most impactful optimization you can make to a database-backed Node.js application. Without it, every query opens a new TCP connection, authenticates, executes, and tears down — a process that can take 20-50ms of pure overhead before your query even runs."** Pooling reuses warm connections and removes that per-request overhead.
4. **Caching delivers the largest end-user latency reductions** — in-process LRU (<1 ms), Redis (~1–5 ms), and HTTP/CDN caching can turn hundreds-of-ms responses into single-digit ms.
5. **Worker Threads are the correct tool for CPU-bound work** (image processing, PDF generation, crypto hashing, large JSON parsing) — but only via a reused worker *pool*, never a fresh worker per request.
6. **Production config is low-effort, high-return:** `NODE_ENV=production` alone can improve Express performance up to 3x; cluster mode multiplies throughput across cores; `UV_THREADPOOL_SIZE` and V8 heap flags fix specific bottlenecks.

## Details

### 1. Event loop optimization
Node's event loop cycles through phases (timers → pending → poll → check → close). Because JavaScript runs single-threaded, one slow synchronous call blocks the entire process — incoming requests queue and latency spikes for everyone. High-risk operations: large JSON parse/stringify, applying logic over huge arrays, unsafe/catastrophic regex (ReDoS), synchronous `fs` and `crypto`.

**Fixes:**
- **Partition long jobs.** Break big loops into chunks and yield with `setImmediate` so the loop can service I/O between chunks. Recursive `process.nextTick` will *starve* I/O because the nextTick queue drains completely before the loop advances; recursive `setImmediate` does not, since each call runs on the next iteration.
- **`process.nextTick` vs `setImmediate`:** `nextTick` callbacks run immediately after the current operation, before the loop continues (higher priority, risk of I/O starvation). `setImmediate` callbacks run in the check phase of the next iteration. Node's own guidance: prefer `setImmediate` in most cases because it's easier to reason about and won't starve the loop.
- **Detect blocking:** use `clinic doctor` (flags event-loop delay), `blocked-at` (reports the blocking call stack), Sentry's `eventLoopBlockIntegration({ threshold })`, or send `SIGUSR1` to a running process to attach a profiler without a redeploy. Keep synchronous operations under ~10 ms.

### 2. Async/await & Promise best practices
The most common async latency bug is **awaiting independent operations sequentially**. `async/await` and `.then()` have identical runtime performance; the bottleneck is structure.

```js
// SLOW: 3 sequential round-trips (sum of latencies)
const a = await fetchA();
const b = await fetchB();
const c = await fetchC();

// FAST: overlap the waiting (max of latencies)
const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()]);
```
- `await` inside a `for` loop over independent items forces serial execution — map to promises and `Promise.all` instead. For large batches, bound concurrency with `p-queue`/`p-map` (e.g. concurrency 5) so you don't overload the DB or downstream service.
- Use `Promise.allSettled` when partial failure is acceptable (one broken widget shouldn't fail the page). Note `Promise.all` rejects on the first rejection — always handle errors to avoid unhandled rejections crashing the process.
- `Promise.all` is concurrent, not multi-threaded — it overlaps I/O wait, it does not run JS in parallel.
- Avoid unnecessary `async` wrapping and redundant `await` on values you immediately return; return the promise directly where possible.

### 3. HTTP framework choice & configuration
**Official fastify/benchmarks (github.com/fastify/benchmarks), run Sept 1 2026, Node v24.20.0, linux x64 / 4 vCPUs / 15.6 GB, `autocannon -c 100 -d 40 -p 10`:**

| Framework | Version | Req/s | Avg latency |
|---|---|---|---|
| fastify | 5.12.1 | 66,507 | 14.56 ms |
| node-http (raw) | v24.20.0 | 63,241 | 15.30 ms |
| koa | 3.2.1 | 49,815 | 19.61 ms |
| hapi | 21.4.10 | 43,934 | 22.23 ms |
| express | 5.2.1 | 36,487 | 26.89 ms |
| express + middlewares | 5.2.1 | 29,861 | — |

The repo explicitly cautions these "do not pretend to represent a real-world scenario, but they give a good indication of the framework overhead," and that GitHub Actions "noisy neighbor" variance means "results can vary." (In this particular run Fastify slightly edged raw `node-http` — a normal artifact of CI variance.) Fastify's advantages are architectural: JSON-Schema-based serialization compiled at startup (via `fast-json-stringify`), the fast `pino` logger, and an encapsulated plugin system instead of a per-request middleware walk.

**Configuration guidance regardless of framework:**
- **Middleware order and count matter** — Express runs middleware in definition order, and every global middleware runs on every request. Mount expensive middleware (auth, body parsing, validation) only on the routes that need them; put cheap guards first. Trim third-party middleware (`helmet`, `cors`, `morgan`) to only needed features.
- **Fast serialization:** `fast-json-stringify` compiles a JSON Schema into a dedicated serializer. Per the official fastify/fast-json-stringify repo it is headlined as "2x faster than JSON.stringify()" and notes it "is significantly faster than JSON.stringify() for small payloads. Its performance advantage shrinks as your payload grows" — so gains are real but payload- and Node-version-dependent (built into Fastify; available for Express via `express-fast-json-stringify`). Benchmark on your own Node version and payload before adopting it in a hot path.
- **Verdict:** For a *new* high-throughput TypeScript API, choose Fastify. For a large existing Express app whose bottleneck is the database, migration cost usually won't pay off — optimize the DB/caching layer instead.

### 4. Connection pooling
Every new DB connection costs a TCP handshake (~0.5–1 ms same-DC, 20–80 ms cross-region) plus TLS (1–2 more round trips) — roughly 20–50 ms of pure overhead before your query runs.

- **PostgreSQL (`pg`):** use `new Pool({ max, min, idleTimeoutMillis, connectionTimeoutMillis })`. Always attach `pool.on('error', …)` (an idle connection dropped by the DB/network can otherwise crash the process), create the pool once at startup (never per request), and drain it on graceful shutdown.
- **Sizing:** a common starting formula is `(CPU cores * 2) + 1`; a practical rule is 10–20 per instance for small/medium apps. **The critical gotcha: total DB connections = pool size × number of instances.** With Postgres default `max_connections = 100`, 6 instances × 20 = 120 exceeds the ceiling before admin/migration tools. Leave headroom (~10 connections) for monitoring and migrations. For serverless/autoscaling, front the DB with **PgBouncer** (transaction pooling) or a provider pooler (Aurora Serverless, Neon).
- **HTTP keep-alive for external calls:** reuse TCP/TLS connections with a keep-alive agent created once at startup. **`undici`** (the Node HTTP client, also backing `fetch`) supports keep-alive natively and is much faster than the legacy `http` client; configure `new Agent({ connections, pipelining, keepAliveTimeout, keepAliveMaxTimeout })`. Add DNS caching (`cacheable-lookup`, TTL 60–120 s) to remove resolver jitter.
- **Server keep-alive:** Node's server `keepAliveTimeout` defaults to 5 s; behind a load balancer set `server.keepAliveTimeout` ≥ the LB's idle timeout (e.g. ~61 s for a 60 s ELB) so the server doesn't close connections the LB still thinks are alive, causing resets.

### 5. Caching strategies
The production standard is a three-layer hierarchy, each layer orders of magnitude faster than the next:
- **L1 in-process LRU** (`lru-cache`): sub-millisecond, no network hop, ideal for hot reference data (config, lookup tables, feature flags, JWT signing keys). Always bound with `max` and `ttl` to avoid unbounded memory growth.
- **L2 Redis** (cache-aside): ~1–5 ms, shared across all instances, survives deploys. Use for expensive/shared data. **Never use `KEYS` in production** — it's O(N) and blocks Redis's event loop; use `SCAN`. Wrap caching at the data-access layer, not in route handlers.
- **L3 HTTP/CDN:** `Cache-Control` (`max-age`, `public/private`, `stale-while-revalidate`), `ETag`/`If-None-Match` (return `304 Not Modified` to skip re-download), and `Last-Modified`. `stale-while-revalidate` serves stale content instantly while refreshing in the background, preventing thundering herds.
- **Invalidation** is the hard part: TTL-only suffices for most systems; add event-driven or version-tagged/surrogate keys where correctness matters. Keep L1 TTL ≤ L2 TTL so local processes still receive propagated updates. Instrument hit rates from day one — a hit rate <50% on cache-aside usually means TTL too short or key space too large. Guard against cache stampedes with probabilistic early expiration.

### 6. CPU-bound work offloading
CPU-bound work (hashing, image/PDF processing, compression, parsing massive JSON/CSV) blocks the event loop and must move off the main thread.
- **Worker Threads** (`worker_threads`, stable since Node 12) are the recommended tool for computation that takes more than a few milliseconds. They share process memory (transfer `ArrayBuffer` ownership or use `SharedArrayBuffer` to avoid copying large data).
- **Use a worker *pool*, not a worker per request.** Spawning a new worker per request creates a new V8 instance each time; the creation/teardown overhead negates the benefit and adds latency. Keep pool size near the number of CPU cores — more threads than cores causes context-switching overhead.
- **`child_process`** is for running separate programs/scripts or isolating crashes; heavier than threads (separate memory). **Cluster mode** is for scaling the *whole app* across cores, not for one-off CPU tasks.
- **Do not** use workers for I/O-bound work — Node's async I/O already handles that far more efficiently.

### 7. Memory & GC optimization
Node is long-lived and single-process, so leaked references accumulate across every request until V8 exhausts the heap (OOM/restart). GC "stop-the-world" pauses also add latency.
- **Common leak sources:** uncleared `setInterval`/`setTimeout`, `EventEmitter` listeners never removed, unbounded global caches/arrays, closures capturing large scopes.
- **Detection:** take 2–3 heap snapshots under load via `--inspect` + Chrome DevTools (Memory → Compare), sort by retained size delta, follow the retainer chain to the owning GC root, fix, and verify memory plateaus after GC. A leak is memory that keeps rising and doesn't drop after GC.
- **Fixes:** bound caches (LRU with `max`), use `WeakMap` for ephemeral keyed data, clear timers/listeners, avoid large allocations in hot paths (reduces GC pressure).
- **Streams for large payloads:** never read a large file/response fully into memory — stream it. Use `pipeline()` from `stream/promises` for safe, backpressure-aware, auto-cleanup chaining. This keeps memory flat and avoids OOM on big payloads.

### 8. I/O optimization
- **Compression:** enable gzip/brotli. Brotli gives better ratios (text can shrink 70–90%); a 500 KB JSON response compresses to ~50 KB. Trade-off: brotli at high quality costs more CPU, so for dynamic API responses use gzip at a mid level or brotli at low/mid to protect TTFB; **pre-compress static assets with brotli at max quality** at build time. Skip compression for already-compressed content (images/video), and don't compress responses with `Cache-Control: no-transform`. For high-traffic sites, doing compression at the reverse proxy (nginx) offloads it from Node entirely. Set a minimum size threshold (default ~1 KB) to avoid compressing tiny bodies.
- **Streaming responses** let the client start receiving before the whole payload is built, cutting time-to-first-byte for large results.
- **Body parsing limits:** cap request bodies (e.g. `express.json({ limit: '1mb' })`) to reduce parse cost and DoS exposure.
- **Logging is I/O too:** `console.log` is synchronous and slow; under load it measurably raises p99. Use **`pino`** (JSON, async, transports on a worker thread) — Fastify's default logger. Per Pino's official benchmarks (github.com/pinojs/pino), on 10,000 basic `pino.info('hello world')` operations "Winston average: 270.249ms / Pino average: 114.801ms" (~2.35x faster), and for object logging "WinstonObj average: 273.120ms / PinoObj average: 119.315ms" (~2.29x). Even fast logging has cost, so log sparingly on hot paths and pipe stdout to a separate process.

### 9. Profiling tools
Don't guess — measure. A repeatable workflow:
1. **Baseline load:** warm the process, then a fixed load (`autocannon -c 64 -d 30`), recording p50/p95/p99, RPS, CPU, RSS, GC pauses. Pin the same Node version and env across runs.
2. **`clinic doctor`** first — it categorizes the problem (event-loop delay, I/O, memory, or CPU) so you look in the right place. Then `clinic flame` (CPU hot paths) and `clinic bubbleprof` (async/idle time between callbacks — great for slow DB/external calls).
3. **`0x`** for a fast on-box flamegraph (`npx 0x -- node server.js` or attach `-P <pid>`); the widest/darkest-red blocks at the top are functions blocking the event loop.
4. **Built-in V8 profiler** when you can't install tools: `node --prof server.js`, then `node --prof-process isolate-*.log`; read the "Bottom up (heavy) profile" for the hottest stacks.
5. **`--inspect` + Chrome DevTools** for interactive CPU profiles and heap snapshots.
- Real-world payoff example: one team found 70% of CPU time in a synchronous `crypto.pbkdf2`; moving it to worker threads cut latency ~60% and nearly doubled throughput. Note profilers add overhead — validate in staging under production-like load, and avoid heavy diagnostic flags (`--trace-gc`, `--prof`, `--trace-events-enabled`) in steady-state production.

### 10. Production configuration
- **`NODE_ENV=production`:** makes Express cache view templates and generated CSS. Per the Express.js official "Production best practices: performance and reliability" guide, "Tests indicate that just doing this can improve app performance by a factor of three!" Set it via your init system/orchestrator, not in code.
- **Cluster mode:** Node uses one core per process; run one worker per core (built-in `cluster` module, or **PM2** `-i max` / `exec_mode: 'cluster'`) behind a shared port with round-robin load balancing. PM2 adds zero-downtime `reload`, automatic worker respawn, and `max_memory_restart`. Reported throughput gains are large (one guide measured a 716% increase); leave a core's headroom if a DB/cache runs on the same box.
- **`UV_THREADPOOL_SIZE`:** libuv's thread pool defaults to **4** threads and is used for `fs`, DNS (`getaddrinfo`), and CPU-bound core work in `zlib`/`crypto`. More than 4 concurrent such operations queue behind each other. Raise it (max 1024) — a common recommendation is the number of logical cores — **before** any I/O call (the pool is instantiated on first use and can't be resized after). Less useful when you already run many processes via cluster.
- **V8 heap flags:** set `--max-old-space-size` to ~75% of the container memory limit (V8 doesn't read cgroup limits, so without this a container can be OOM-killed unpredictably); default old-space is ~1.5 GB on 64-bit regardless of available RAM. Consider raising `--max-semi-space-size` to 64 MB for allocation-heavy services (fewer minor GCs / premature promotions), then re-measure. Akamas' V8 tuning case study ("Node.js Performance: Tuning V8 Memory & GC Settings") reports that "by tuning V8's young and old heap generations, we got a performance speedup of 11% and 45% respectively... the CPU used by the application was reduced by 22% and 68% respectively" — with no code changes. Lock chosen flags into `NODE_OPTIONS`. Also useful: `--enable-source-maps` and `--unhandled-rejections=strict`. Change one flag at a time and validate under real load — defaults are good for general workloads.

## Recommendations

**Stage 0 — Measure (before touching anything).** Establish a baseline with autocannon at fixed concurrency and record p50/p95/p99, RPS, CPU, RSS. Run `clinic doctor` to classify the bottleneck. *Threshold to proceed:* if event-loop delay is high → Stage 1; if CPU is pegged → Stage 2; if the process is mostly idle/waiting → Stages 3–4 (I/O).

**Stage 1 — Unblock the event loop (biggest win if you're blocking).** Replace sync `fs`/`crypto`, fix catastrophic regex, chunk large loops with `setImmediate`, move heavy JSON off the hot path. *Benchmark that changes the plan:* if p99 event-loop delay drops below ~10–20 ms and CPU is still high, go to Stage 2.

**Stage 2 — Offload CPU & parallelize.** Move CPU-bound work to a Worker Thread *pool* (size ≈ cores). Convert sequential independent awaits to `Promise.all` (with bounded concurrency for batches). Enable cluster mode / PM2 to use all cores.

**Stage 3 — Pool connections.** Add a `pg`/`mysql2`/`mongoose` pool created once at startup with error handlers and graceful drain; size it as `pool × instances ≤ DB max − headroom`. Add a keep-alive `undici` agent + DNS cache for external calls; align server `keepAliveTimeout` with your LB.

**Stage 4 — Cache.** Add L1 LRU for hot reference data, L2 Redis cache-aside for shared data, and HTTP `Cache-Control`/`ETag` + CDN with `stale-while-revalidate` for public endpoints. Instrument hit rate; *threshold:* hit rate <50% → revisit TTL/key design.

**Stage 5 — Trim the wire.** Enable brotli/gzip (or offload to nginx), stream large payloads with `pipeline()`, cap body size, switch to `pino` logging, and adopt `fast-json-stringify` for hot JSON endpoints.

**Stage 6 — Tune production config.** Confirm `NODE_ENV=production`; set `UV_THREADPOOL_SIZE` if fs/DNS/crypto-bound; set `--max-old-space-size` to ~75% of container RAM; test `--max-semi-space-size=64`. Lock into `NODE_OPTIONS`.

**Stage 7 — Framework (only if framework overhead is proven to dominate).** If profiling shows framework/serialization overhead is the bottleneck on trivial endpoints and you're greenfield, choose Fastify; otherwise keep Express and optimize the layers above.

## Caveats
- **Benchmark numbers are noisy and context-dependent.** The fastify/benchmarks figures run on shared GitHub Actions hardware and the repo itself warns results vary run-to-run and "do not pretend to represent a real-world scenario." The secondary Express/Fastify multipliers circulating online (2x, 3x, 5.6x, 9.7x) come from different machines, Node versions, and workloads and are not directly comparable — treat them as directional. Always benchmark your own workload.
- **Most published "X× faster" latency reductions are single-source, best-case anecdotes** (e.g. "600 ms → 6 ms," "latency halved," "716% throughput"). They illustrate the mechanism, not a guaranteed result for your app.
- **Optimizations interact and can regress.** Raising `UV_THREADPOOL_SIZE` or V8 flags can hurt if mis-set; over-large DB pools overwhelm the database; aggressive caching creates correctness/invalidation bugs that are invisible under light load and catastrophic under heavy load. Change one variable at a time and validate under production-like load.
- **Some cited sources are AI-generated or vendor blogs** (e.g. the "AXIOM experiment" posts and various hosting-vendor guides). Their patterns align with primary sources (Node.js docs, Express docs, libuv docs, fastify/benchmarks, pinojs/pino), which should be treated as authoritative where they conflict.
- Node.js and V8 defaults change across versions; verify flag behavior and defaults against the docs for your specific runtime.