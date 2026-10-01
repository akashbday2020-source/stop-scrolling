const FILLERS = /\b(um|uh|like|you know|actually|basically)\b/gi;

function analyze(prompt, transcript, durationSeconds) {
  const text = String(transcript || "").trim().slice(0, 12000);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const fillerCount = (text.match(FILLERS) || []).length;
  const seconds = Math.max(Number(durationSeconds) || 1, 1);
  const wpm = Math.round((words.length / seconds) * 60);
  const unique = new Set(words.map(w => w.toLowerCase().replace(/[^a-z']/g, ""))).size;
  const structured = /\b(first|second|finally|because|however|for example|then|the main|my point)\b/i.test(text);

  return {
    prompt,
    clarity: words.length >= 35 ? "Good" : "Needs more detail",
    structure: structured ? "Clear signposting" : "Add a simple beginning-middle-end structure",
    vocabulary: unique >= Math.max(12, words.length * 0.55) ? "Varied" : "Try more precise word choices",
    fillerCount,
    wpm,
    wordCount: words.length,
    tip: fillerCount > 2
      ? "Replace filler words with a short pause."
      : wpm > 170
        ? "Slow down slightly and land your key points."
        : wpm < 90
          ? "Add a little more detail and energy."
          : "Keep your pace and focus on specific examples.",
    source: "instant-analysis"
  };
}

async function api(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return Response.json({ ok: true, service: "stop-scrolling", platform: "cloudflare-worker" });
  }

  if (url.pathname === "/api/sessions" && request.method === "POST") {
    return Response.json({ ok: true, saved: false, message: "Local history is active; Supabase persistence will be connected next." });
  }

  if (url.pathname === "/api/analyze" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.prompt || !body.transcript) {
      return Response.json({ error: "prompt and transcript are required" }, { status: 400 });
    }

    const fallback = analyze(body.prompt, body.transcript, body.durationSeconds);

    if (!env.OPENAI_API_KEY) return Response.json(fallback);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5-mini",
          input: `You are a concise speaking coach. Analyze this response. Return ONLY valid JSON with keys: clarity, structure, vocabulary, strengths (array of 2 strings), improvements (array of 2 strings), nextDrill (string). Do not score the person. Prompt: ${String(body.prompt).slice(0, 500)} Response: ${String(body.transcript).slice(0, 12000)}`
        })
      });

      if (!response.ok) throw new Error("OpenAI request failed");
      const data = await response.json();
      const raw = data.output_text || "";
      const ai = JSON.parse(raw.replace(/^\s*\`\`\`json\s*|\s*\`\`\`\s*$/g, ""));
      return Response.json({ ...fallback, ...ai, source: "ai" });
    } catch {
      return Response.json(fallback);
    }
  }

  return env.ASSETS.fetch(request);
}

export default { fetch: api };
