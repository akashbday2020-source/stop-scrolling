const FILLERS = /\b(um|uh|like|you know|actually|basically)\b/gi;

function instantAnalysis(prompt, transcript, durationSeconds) {
  const text = String(transcript || "").trim().slice(0, 12000);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const fillerCount = (text.match(FILLERS) || []).length;
  const seconds = Math.max(Number(durationSeconds) || 1, 1);
  const wpm = Math.round(words.length / seconds * 60);
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z']/g, ""))).size;
  const hasStructure = /\b(first|second|finally|because|however|for example|so|then|the main|my point)\b/i.test(text);

  return {
    prompt,
    clarity: words.length >= 35 ? "Good" : "Needs more detail",
    structure: hasStructure ? "Clear signposting" : "Add a simple beginning-middle-end structure",
    vocabulary: uniqueWords >= Math.max(12, words.length * 0.55)
      ? "Varied"
      : "Try more precise word choices",
    fillerCount,
    wpm,
    wordCount: words.length,
    sentenceCount: sentences.length,
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

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const { prompt, transcript, durationSeconds = 45 } = body;

  if (!prompt || !transcript) {
    return Response.json(
      { error: "prompt and transcript are required" },
      { status: 400 }
    );
  }

  const heuristic = instantAnalysis(prompt, transcript, durationSeconds);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) return Response.json(heuristic);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5-mini",
        input: [{
          role: "user",
          content: `You are a concise speaking coach. Analyze this spontaneous speaking response. Return ONLY valid JSON with keys: clarity, structure, vocabulary, strengths (array of 2 strings), improvements (array of 2 strings), nextDrill (string). Do not score the person. Prompt: ${String(prompt).slice(0, 500)} Response: ${String(transcript).slice(0, 12000)}`
        }]
      })
    });

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);

    const data = await response.json();
    const raw = data.output_text ||
      data.output?.flatMap(x => x.content || [])
        .find(x => x.type === "output_text")?.text || "";

    const ai = JSON.parse(raw.replace(/^\s*\`\`\`json\s*|\s*\`\`\`\s*$/g, ""));
    return Response.json({ ...heuristic, ...ai, source: "ai" });
  } catch {
    return Response.json(heuristic);
  }
}
