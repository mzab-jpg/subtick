# TANGENT RECOMMENDATION PIPELINE
## THE ANATOMY OF RECOMMENDATION ALGORITHMS: SYSTEM REDESIGN & MATHEMATICAL RESTRUCTURE

- **Document Reference:** SYS-SPEC-V2-REBUILD
- **Date of Verification:** 26 August 2026
- **Author/Persona:** Senior Software Architect
- **System Status:** Production-Ready Blueprint
- **Backend Service:** Cloud Functions v2 & Firestore
- **Framework Context:** React Native 0.86 / Expo SDK 57

---

## TABLE OF CONTENTS
1. [Executive Architectural Summary](#1-executive-architectural-summary)
2. [Pillar A: Standardized Memory Scales [0.0, 1.0]](#2-pillar-a-standardized-memory-scales-00-10)
3. [Sigmoid Calibration & Tuning Specification](#3-sigmoid-calibration--tuning-specification)
4. [Pillar B: The Unified Engagement Index (E)](#4-pillar-b-the-unified-engagement-index-e)
5. [Pillar C: Single-Pass Discounted Penalty Selection](#5-pillar-c-single-pass-discounted-penalty-selection)
6. [Database & Infrastructure Modernization](#6-database--infrastructure-modernization)
7. [Client-Side Performance & Platform Parity](#7-client-side-performance--platform-parity)
8. [Architectural Comparison: Old vs. Streamlined Setup](#8-architectural-comparison-old-vs-streamlined-setup)

---

### 1. EXECUTIVE ARCHITECTURAL SUMMARY
Tangent operates as an interactive, gesture-driven reading client designed to curatively deliver exactly 30 article cards from an active library of thousands of Substack newsletters. The legacy prototype architecture proved the product concept but introduced extensive "accidental complexity"—brittle heuristics, overlapping classification systems, and hardcoded values that created significant database overhead and visual performance bottlenecks on clients.

To build a robust, enterprise-grade system, we are implementing a unified **Three-Pillar System Redesign**. This specification details the complete structural and mathematical blueprint to guide our refactoring sprint. By transitioning to standardized scales, collapsing double-layered telemetry into a single, continuous Engagement Index, replacing fragile post-processing loops with a declarative selection pass, and modernizing our database structure, we ensure absolute predictability, scalability, and system clarity.

---

### 2. PILLAR A: STANDARDIZED MEMORY SCALES [0.0, 1.0]
To score and rank candidate articles fairly, the recommendation engine rescales all inputs onto a 0-to-1 ruler. In the legacy system, individual memory modules operated under separate, disjointed scales—creating mathematical distortion and complicating system configurations.

#### Personal Fit Scoring Formula (The Latent Preference Sigmoid)
- **The Problem:** In our legacy code, user category and publisher preferences were stored on an arbitrary scale of `[0.1, 5.0]`. Normalizing this on-the-fly compressed our default, neutral weight of 1.0 (indicating no prior interaction) down to a weak 18.3% score:
  $$\text{Normalized Score} = \frac{1.0 - 0.1}{5.0 - 0.1} = \frac{0.9}{4.9} \approx 18.3\%$$
  The scorer actively penalized neutral or unobserved topics, treating them as disliked. Furthermore, the 0.1 and 5.0 limits were hardcoded inline, creating "two sources of truth" bugs where dashboard-level clamp modifications silently failed to affect the scorer.
- **The Solution:** We are migrating to a **Double-Sided Preference Sigmoid** model. Instead of storing a bounded preference weight directly in Firestore, we store an unbounded **Latent Preference Score ($x$)** in the range $(-\infty, \infty)$ for each category and publisher. We initialize $x = 0.0$ to represent a strictly neutral starting preference. At runtime, we map the latent score $x$ to our standard $[0.0, 1.0]$ Personal Fit ($P$) coordinate using a standard symmetric logistic sigmoid:
  $$P(x) = \frac{1}{1 + e^{-x}}$$
  This ensures $P(0.0) = 0.5$ is strictly neutral. Scoring Personal Fit ($P$) becomes a direct weighted sum of these sigmoid-mapped outputs, completely eliminating runtime normalization:
  $$P = w_{\text{cat}} \times P(x_{\text{cat}}) + w_{\text{pub}} \times P(x_{\text{pub}})$$
  *Where $w_{\text{cat}}$ and $w_{\text{pub}}$ are config-level weights. For established publishers, we use a 60/40 category/publisher blend. For cold-start publishers (unvisited by the user), the system shifts dynamically to a 90/10 blend, allowing topic exploration.*

#### Trending Heat Saturation Sigmoid
- **The Problem:** Legacy trending normalized scores by dividing raw heat ($S$) by a hardcoded cap of 50. During rapid traffic spikes, scores would overflow past 1.0 and break overall scoring balances. Conversely, under normal traffic, even hot articles only reached a raw score of $\approx 10.6$, yielding a normalized score of just $\approx 0.21$, making trending momentum functionally inert.
- **The Solution:** We are replacing division with a standard, self-calibrating saturation sigmoid (Hill-type curve):
  $$T = \frac{S}{S + k}$$
  *Where $S$ is the raw trending heat score and $k$ is the half-saturation constant. To prevent our trending engine from breaking as our active reader base grows, $k$ is scaled dynamically relative to Daily Active Users (DAU), keeping the physical effort required for an article to trend completely self-calibrating across platform lifecycles.*

#### Publisher Quality (Q) Collective Sigmoid
- **The Problem:** Publisher quality scores in the legacy prototype started at `0.8` and were clamped to `[0.2, 1.0]`. The normalizer used a complex, arbitrary piecewise curve mapping `0.8 -> 0.75`, `1.0 -> 1.0`, and `0.2 -> 0.0` simply to "nudge" default publishers.
- **The Solution:** We are standardizing Publisher Quality under the same symmetric sigmoid framework. We store an unbounded latent collective reputation score $y \in (-\infty, \infty)$ in each publisher's document. At runtime, we map this latent score to our standard $[0.0, 1.0]$ trust index ($Q$) via:
  $$Q(y) = \frac{1}{1 + e^{-y}}$$
  To establish our optimistic baseline of exactly `0.80`, we initialize the latent score of new publishers to $y_{\text{seed}} = \ln(4) \approx 1.386$. Collective crowd feedback applies tiny, bounded updates to $y$ at write-time, and $Q(y)$ is calculated dynamically at runtime, removing any need for piecewise rescaling.

---

### 3. SIGMOID CALIBRATION & TUNING SPECIFICATION
Implementing sigmoid curves provides perfect, self-regulating boundaries, but calibrating the rate of change and sensitivity of each curve is critical to avoid hyper-sensitivity or stagnation. This section details the complete mathematical and behavioral specifications for tuning our three sigmoid systems.

#### 1. Trending Sigmoid Calibration (k-Tuning & DAU-Scaling)
The half-saturation constant $k$ defines the inflection point of our trending curve—the exact raw score ($S$) where the normalized trending component $T$ reaches exactly $0.50$. To calibrate $k$, we evaluate the derivative of the Hill-type curve, which defines our **sensitivity (the rate of change of $T$ per raw score unit)**:
$$\frac{dT}{dS} = \frac{k}{(S + k)^2}$$

This derivative establishes three distinct operational zones:
- **Inception Zone ($S = 0$):** Sensitivity is at its absolute peak: $\frac{1}{k}$. For $k = 10$, a single unit of raw score yields a massive **10.0% jump** in $T$. Newly published articles are highly sensitive to initial engagement.
- **Half-Saturation Zone ($S = k$):** Sensitivity has dropped to $\frac{1}{4k}$. For $k = 10$, each raw score unit yields a **2.5% jump** in $T$.
- **Viral Saturation Zone ($S \gg k$):** Sensitivity asymptotically approaches $0.0$. For $S = 90$ and $k = 10$, sensitivity is only $\frac{10}{10000} = 0.1\%$. The article has reached its maximum trending authority, preventing viral runaways.

##### The Cohort Sizing Model
We define our raw feedback increments based on telemetry events: Saves ($+3.0$), Likes ($+2.0$), and Thorough Reads ($+1.5$). We calibrate $k$ by asking: *How many highly engaged, sequential readers should it take to push a brand-new article to a solid trending score of $0.50$ ($S = k$)?*

If we target a **Critical Mass Cohort of 5 highly engaged readers**:
- 5 readers thoroughly read the article ($5 \times 1.5 = +7.5$ raw score).
- 2 of those readers like it ($2 \times 2.0 = +4.0$ raw score).
- 1 of those readers saves it ($1 \times 3.0 = +3.0$ raw score).
- **Total Raw Score ($S$):** $7.5 + 4.0 + 3.0 = 14.5$.
- Setting **$k = 10.0$** ensures this cohort successfully pushes the article to $T = \frac{14.5}{14.5 + 10} \approx 0.59$, making it highly competitive in the feed.

##### The Dynamic DAU-Scaling Law
To prevent our trending feed from becoming oversaturated as our active user base scales, we dynamically adjust $k$ on our backend using a linear function of Daily Active Users (DAU), with a hard floor of $10.0$:
$$k = \max\left(10.0, \; \text{DAU} \times \text{Target Cohort Fraction } (0.01)\right)$$
- At **500 DAU** (Early Beta), $k$ clamps to **10.0**. A cohort of 5 readers drives an article to $T = 0.50$.
- At **5,000 DAU** (Launch), $k$ scales to **50.0**. It now requires $S = 50.0$ (a cohort of $\approx 25$ deep readers) to hit $T = 0.50$.
- This mathematically guarantees that the percentage of the active user base required to trend an article remains perfectly constant at exactly **1.0%**, keeping the system self-calibrating across platform lifecycles.

#### 2. Personal Fit Sigmoid Calibration (Pivot Velocity & Asymmetry)
User preferences must adapt quickly to genuine interest changes, but remain highly resilient to accidental misclicks or quick exits. We control this behavior by defining the **Pivot Velocity ($N$)**—the number of consecutive thorough reads ($E = 1.0$) required to move a user's preference from strictly neutral ($P = 0.50, x = 0.0$) to a strong enthusiast state ($P = 0.90, x \approx 2.20$).

We calculate our positive latent preference step size ($\delta_{\text{cat}}$) by solving the sigmoid:
$$2.20 = N \times \delta_{\text{cat}} \implies \delta_{\text{cat}} = \frac{2.20}{N}$$
- **Hyper-Responsive Pivot ($N = 5$):** $\delta_{\text{cat}} = 0.44$ per thorough read. The feed adapts to a new interest in a single weekend.
- **Balanced Production Pivot ($N = 8$):** $\delta_{\text{cat}} = 0.275$ per thorough read.
- **High-Inertia Stable Pivot ($N = 15$):** $\delta_{\text{cat}} = 0.15$ per thorough read. Requires sustained intent over several weeks to shift.

##### The Asymmetric Rejection Guard
To protect the feed from clickbait, negative user feedback (Quick Exits/Swipes) must penalize preferences with a significantly higher velocity than positive reads. We enforce an **Asymmetric Delta Rule**:
$$\delta_{\text{negative}} = -2.5 \times \delta_{\text{cat}}$$
Using our Balanced Pivot ($\delta_{\text{cat}} = 0.275$):
- A positive thorough read adds $+0.275$ to the latent score $x$.
- A Quick Exit subtracts a heavy latent penalty: $\delta_{\text{negative}} = -0.6875$. 
- At neutral ($x = 0.0, P = 0.50$), a single Quick Exit drops the latent score to $-0.6875$, instantly suppressing the category score to $P(-0.6875) \approx 0.33$, removing it from upcoming feed competition.

##### Nightly Latent Drift
To prevent historical preferences from permanently locking a user's feed, we apply a daily decay force ($\lambda$) directly to our latent scores at midnight, slowly melting them back toward our strictly neutral starting point ($x = 0.0$):
$$x_{t+1} = x_t \times \lambda$$
Using **$\lambda = 0.95$ (5.0% daily decay)**, an extremely active preference of $x = 3.0$ ($P \approx 0.95$) will organically melt back to near-neutral ($x < 0.50, P \approx 0.62$) over **35 days of complete inactivity**, allowing the feed to refresh and explore naturally.

#### 3. Publisher Quality Sigmoid Calibration (The Veto Ratio)
Publisher Quality ($Q$) represents slow-evolving collective trust. It requires massive inertia to protect high-quality writers from isolated bad days or malicious down-voting. We configure this by establishing extremely small collective update steps ($\gamma$):
- **Thorough Read:** $\gamma_{\text{positive}} = +0.005$
- **Quick Exit / Swipe:** $\gamma_{\text{negative}} = -0.010$

##### The 2:1 Veto Ratio
Because collective rejections are penalized twice as heavily as positive reads, we establish a **2:1 Veto Ratio**. We calculate the stable equilibrium of a publisher's latent reputation $y$ under mixed user feedback:
$$\text{Net Change } (\Delta y) = P_{\text{thorough}} \times \gamma_{\text{positive}} + P_{\text{reject}} \times \gamma_{\text{negative}} = 0$$
$$P_{\text{thorough}} \times (0.005) + (1 - P_{\text{thorough}}) \times (-0.010) = 0 \implies 0.015 \cdot P_{\text{thorough}} = 0.010 \implies P_{\text{thorough}} \approx \mathbf{66.7\%}$$
This is an elegant game-theoretic threshold. A publisher's collective reputation will remain completely stable or rise *only* if **at least 66.7% of readers thoroughly engage with their content**. If their deep-engagement rate falls below this threshold, their score will begin to decline.

##### Measuring Quarantine Speed
Let's calculate the exact number of consecutive rejections required to completely quarantine a failing publisher, moving their quality score from our optimistic $0.80$ seed baseline down to our $0.20$ quarantine floor:
- Starting Latent Score ($Q = 0.80$): $y_{\text{seed}} = 1.386$
- Target Quarantine Floor ($Q = 0.20$): $y_{\text{target}} = -1.386$
- **Required Latent Change ($\Delta y$):** $-2.772$
- If 100% of readers reject their articles:
  $$\text{Required Interactions} = \frac{-2.772}{-0.010} = \mathbf{277.2 \text{ total sessions}}$$
This safety window provides an outstanding collective buffer. It gives a publisher exactly **277 reading opportunities** to stabilize their quality before they are pushed to the bottom of our selection loops and quarantined.

---

### 4. PILLAR B: THE UNIFIED ENGAGEMENT INDEX (E)
To update user memory and collective scores, the platform must analyze on-device interactions. The legacy system ran telemetry through two parallel, conflicting pipelines: a geometry-only classifier (yielding Thorough, Shallow, or Quick Exit labels) and an Attention-Factor ($A$) speed-scaling model. This created a fragile pipeline where a deep read could have its updates completely zeroed out if scroll speed crossed a rigid 1,750 WPM threshold.

#### The Unified Engagement Index Formula
We are collapsing both pipelines into a single, continuous **Engagement Index ($E$)** calculated on article exit:
$$E = \text{Scroll Depth} \times \text{Pace Penalty}$$
*Where both components are continuous floats in `[0.0, 1.0]`, meaning $E$ behaves as a seamless, continuous scalar. If a user skims rapidly, their Pace Penalty drops, automatically reducing $E$ and dampening the resulting database update without needing binary labels.*

#### Personalized WPM Baselines & Relative Speed Ratio
- **The Problem:** A single, static WPM scale (like the legacy 600/1750 thresholds) is a major design flaw because reading speeds differ wildly between slow and fast readers. Under a flat scale, naturally fast readers are unfairly penalized as skimmers, and slow-reading skimmers are incorrectly credited as deep readers.
- **The Solution:** We track a personalized `averageWpm` for each user, updated with an 80/20 rolling average strictly when sessions pass our Human-Plausibility Band (implied speed of `[80, 600]` WPM and a 150-consumed-word floor). On exit, we calculate a **Relative Speed Ratio ($R_s$)**:
  $$R_s = \frac{\text{Session WPM}}{\text{User's averageWpm}}$$
  We map $R_s$ to our Pace Penalty factor smoothly:
  - **$R_s \le 1.25$:** Pace Penalty = `1.0` (User reads at or up to 25% faster than their normal rate. Full credit is given).
  - **$R_s = 2.00$:** Pace Penalty = `0.5` (User reads at double their baseline speed, indicating active skimming).
  - **$R_s \ge 3.00$:** Pace Penalty = `0.0` (User scrolls at over triple their baseline speed, indicating a mindless fling. Telemetry is algorithmically inert).

*(See Figure 2 in system diagrams for Dynamic Relative Pace Penalty Curves and Telemetry Flows).*

---

### 5. PILLAR C: SINGLE-PASS DISCOUNTED PENALTY SELECTION
Once candidate articles are scored, the ranking engine compiles the final 30-card feed for the reader.

#### The Selection Labyrinth & Deadlock Vulnerability
- **The Problem:** The legacy prototype scored candidates and sorted them into High, Mid, and Tail tranches. It randomly selected items from the High and Mid tranches, and then ran a complex, 5-step post-processing shuffler that manually performed array loops and swaps to enforce a 5-card publisher cap, category variety (min 4 distinct), category interleaving (preventing three-in-a-row), and a 3-card publisher spacing buffer.
- This procedural approach was structurally fragile. When a user had highly concentrated preference weights, or when candidate pools were small during quiet news periods, these hard constraint loops frequently entered **deadlock scenarios**. The engine would lock up, forcing expensive retry loops and introducing unacceptable latency.

#### The Solution: Sequential Greedy Selection with Linear Additive Penalties
We are replacing the entire tranche bucketing and post-processing shuffler with a single, mathematical **Sequential Selection Pass** (modeled after Maximal Marginal Relevance). We score our candidates cleanly via:
$$\text{Score} = w_P \cdot P + w_T \cdot T + w_R \cdot R + w_Q \cdot Q$$
We then construct the feed card-by-card in a single pass of up to 1,000 unread candidates:
- **Hero Reservation:** Identify and lock the absolute highest-scoring eligible article overall into position 0 as the Dashboard opener.
- **Greedy Selection:** For positions 1 through 29, evaluate the remaining candidates and select the card with the highest adjusted score:
  $$\text{Adjusted Score} = \text{Base Score} - (N_{\text{cat}} \times P_{\text{cat}}) - (N_{\text{pub}} \times P_{\text{pub}}) + \text{jitter}$$
- **Linear Additive Penalties:** Instead of applying multiplicative penalties (which penalize high-scoring elite articles too severely and cause "Relevance Collapse"), we subtract constant **linear penalty steps**: Category Penalty Step ($P_{\text{cat}} = 0.15$), Publisher Penalty Step ($P_{\text{pub}} = 0.25$).
  - *Mathematical Spacing:* Each time we select a card, we increment our selected category and publisher counts ($N_{\text{cat}}, N_{\text{pub}}$). The next candidate sharing that category or publisher is penalized linearly, naturally forcing other topics and authors to interleave without any risk of procedural deadlocks.
- **Stochastic Jitter:** We add a tiny random noise factor (uniformly drawn from `[-0.03, 0.03]`) to each candidate's score, keeping the feed feeling organic and alive.
- **Serendipitous Discovery Slots:** To ensure users never get trapped in filter bubbles, every 5th card (slots 4, 9, 14, 19, 24, and 29) is designated as a **Discovery Slot**. For these specific slots, we programmatically set the personalization weight $w_P = 0.0$. This forces the selector to evaluate those slots purely on collective quality, trending heat, and recency, introducing fresh content discovery while maintaining spacing rules.

*(See Figure 3 in system diagrams for Dynamic Score Multipliers and Soft Layout Constraints).*

---

### 6. DATABASE & INFRASTRUCTURE MODERNIZATION
A clean architectural redesign requires robust, scalable underlying database structures and predictable configurations.

#### Bypassing the 1 MB Firestore Limit
- **The Problem:** Firestore enforces a strict 1 MB size limit on individual documents. Our legacy candidate pool generator written in `cronUpdateCandidatePool` compiles up to 2,000 articles as static, flat arrays inside a single document (`system/candidatePool_current`). Given our metadata density, once our active catalog reaches **approximately 1,250 articles, this document will exceed 1 MB**, throwing Firestore exceptions and crashing feed generation for all users.
- **The Solution:** We are migrating to a **Firestore Subcollection Architecture**. Instead of storing a massive flat array in a single document, we write candidate article references into an indexed subcollection path: `system/candidatePools/current/articles/`. By utilizing subcollections, we leverage Firestore's built-in single-field auto-indexing, allowing our candidate pool to scale to millions of articles without ever risking document-size crashes.

#### Unifying System Configurations
We are centralizing all algorithm clamps and weights in a unified `system/scoringConfig` document. The server loads this configuration, merges it over compiled defaults, clamps values to safe bounds, and caches it in memory with a 60-second TTL to keep database reads minimal. Scorer functions (like `normalizeP`) are wired directly to these cached config values, completely eliminating hardcoded inline limits and avoiding "two sources of truth" bugs.

#### Ingestion & Cost-Capped Maintenance Crons
Our system operates with a high focus on cloud write efficiency to minimize running costs:

| Cron Name | Interval | Description & Database Optimization |
| :--- | :--- | :--- |
| **`rssCollector`** | Every 3 Hours | Fetches 42 verified feeds. Performs batch-existence checks with `db.getAll()` to reduce reads. Assigns a stable `random_score` float `[0, 1)` refreshed daily. |
| **`cronDecayTrendingScores`** | Every 24 Hours | Applies `trendingScore x 0.9057`. To reduce database writes by 70%, the decay is only written back for articles with scores `> 1.0`. |
| **`cronCleanupOldArticles`** | Every 3 Days | **Step 1:** Delete all paywalled articles. **Step 2:** Query 500 worst-scoring articles using a composite index and delete the bottom 3% of the sample. Constant read overhead. |

*(See Figure 4 in system diagrams for Ingestion Subsystem and Subcollection Modernization).*

---

### 7. CLIENT-SIDE PERFORMANCE & PLATFORM PARITY
To achieve a seamless, 60fps gesture-driven experience, the mobile application must perform intensive XML parsing and body preloading asynchronously.

#### Android's Native Kotlin RSS Preloader
The Android client features a custom Kotlin-based local Expo module (`modules/tangent-rss-parser`) compiled into Android custom builds. This module handles direct publisher fetching on-device and streams RSS/Atom XML parsing completely outside the React Native JavaScript thread, protecting the single UI thread from blocking. The module preloads and caches the extracted body content for exactly the next five upcoming reader cards concurrently using a maximum of two background native workers. This ensures that when a user swipes forward, the next article body is immediately ready for rendering in the WebView.

#### The iOS Performance Gap & Swift Parity Requirements
The Kotlin implementation is Android-only. iOS devices currently fall back to the JavaScript-based `fast-xml-parser` execution block, which parses XML synchronously on the React Native thread. This causes visible lag, loading spinners, and dropped frames during rapid swipes. To resolve this, we must build a matching Swift-based iOS local Expo module (`modules/tangent-rss-parser/ios/`) before store deployment.

##### The Swift Parity Specification:
- **Non-Blocking Async Parsing:** Utilize iOS `URLSession` and `Foundation.XMLParser` on a low-priority background serial queue, entirely off the React Native JavaScript execution lane.
- **Buffer Management:** Pre-allocate memory buffers and maintain a rolling 5-upcoming-article target buffer (articles 2-6 on opening article 1), lazily sanitizing article HTML only when displayed on screen.
- **Speculative Workers:** Limit lookahead to a maximum of 2 background speculative native workers. If a future lookahead request fails, silently remove it from the active Reader and mounted Dashboard cache, without writing history state to disk.
- **Single-Thread Unmount:** On a forward swipe gesture, immediately unmount the previous native WebView and display an opaque theme surface. Only show a loading spinner if the next card remains unresolved after 180 ms, preventing rapid-swipe white flashes.

---

### 8. ARCHITECTURAL COMPARISON: OLD VS. STREAMLINED SETUP

| Architectural Feature | Legacy Prototype Setup | Proposed Streamlined Setup |
| :--- | :--- | :--- |
| **User Memory ($P$)** | Non-linear `[0.1, 5.0]` scale. Neutral `1.0` gets compressed to `18%` score. | Unbounded latent score $x \in (-\infty, \infty)$ mapped via double-sided sigmoid $P(x) = \frac{1}{1+e^{-x}}$ to standard $[0.0, 1.0]$. Neutral $x = 0.0$ is a true $50\%$ score. |
| **Telemetry / Pace** | Discrete geometry labels + step-wise Attention-Factor. Universal thresholds. | Single continuous Engagement Index ($E = \text{Scroll} \times \text{Pace Penalty}$) relative to individual `averageWpm` ratio. |
| **Feed Selection** | Scoring -> Tranche Bucketing -> Brittle 5-step post-processing shuffler. | Single-pass sequential greedy selection with dynamic variety penalties. |
| **Publisher Quality ($Q$)** | Hardcoded range `[0.2, 1.0]`. Multi-segmented piecewise scaling. | Unbounded latent score $y \in (-\infty, \infty)$ mapped via collective sigmoid $Q(y) = \frac{1}{1+e^{-y}}$ to standard $[0.0, 1.0]$. Optimistic seed $Q = 0.80$ ($y = 1.386$). |
| **Storage Scale** | Flat arrays in single document. Faces crash ceiling at 1,250 articles. | Firestore Subcollections. Infinite scalability, zero document walls. |

---

*This technical specification represents the definitive architecture for our production refactoring sprint, eliminating accidental complexity to deliver a bulletproof, highly performant recommendation engine. Let's build a clean, elegant product. Sapere aude!*
