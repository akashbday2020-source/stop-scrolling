const FILLERS=/\b(um|uh|like|you know|actually|basically|sort of|kind of)\b/gi;

function instantAnalysis(prompt,transcript,durationSeconds){
 const text=String(transcript||'').trim().slice(0,16000),words=text?text.split(/\s+/).filter(Boolean):[],seconds=Math.max(Number(durationSeconds)||1,1);
 const fillerCount=(text.match(FILLERS)||[]).length,wpm=Math.round(words.length/seconds*60),unique=new Set(words.map(w=>w.toLowerCase().replace(/[^a-z']/g,''))).size;
 return{prompt,fillerCount,wpm,wordCount:words.length,overall:'Your response was transcribed, but the AI coach was unavailable. Use the metrics below as a quick baseline.',clarity:words.length>=35?'You gave enough content to work with.':'Your answer was brief; add one concrete example or reason.',structure:/\b(first|second|finally|because|however|for example|then|the main|my point)\b/i.test(text)?'You used some signposting.':'Try a simple point → reason → example → close structure.',relevance:'Keep the first sentence tightly connected to the prompt.',specificity:'Replace general statements with one specific example, action or result.',delivery:wpm>170?'Your pace is fast; add short pauses after key ideas.':wpm<90?'Your pace is slow; add a little more detail per idea.':'Your pace is in a useful speaking range; keep using deliberate pauses.',vocabulary:unique>=Math.max(12,words.length*.55)?'Reasonably varied.':'Some wording may be repetitive.',strengths:['You completed a spontaneous response.'],improvements:[fillerCount>2?'Replace filler words with short pauses.':'Use deliberate pauses between ideas.',wpm>170?'Slow down and land each key point.':wpm<90?'Add a little more detail and energy.':'Finish each idea before moving to the next.'],nextDrill:'Answer the same prompt in 30 seconds using one clear point and one specific example.',source:'instant-analysis'};
}

async function transcribe(request,env){
 const form=await request.formData(),audio=form.get('audio');
 if(!(audio instanceof File))return Response.json({error:'audio file is required'},{status:400});
 if(audio.size>15*1024*1024)return Response.json({error:'audio file is too large'},{status:413});
 const out=new FormData();out.append('file',audio,audio.name||'response.webm');out.append('model',env.OPENAI_TRANSCRIBE_MODEL||'gpt-4o-transcribe');out.append('language','en');
 const prompt=String(form.get('prompt')||'').trim();if(prompt)out.append('prompt',prompt);
 const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:out});
 if(!response.ok)throw new Error('Transcription request failed');
 const data=await response.json();
 return Response.json({transcript:data.text||''});
}

async function aiCoach(prompt,transcript,durationSeconds,env){
 const base=instantAnalysis(prompt,transcript,durationSeconds);
 if(!env.OPENAI_API_KEY)return base;
 const schema={type:'object',additionalProperties:false,properties:{
  overall:{type:'string'},clarity:{type:'string'},structure:{type:'string'},relevance:{type:'string'},specificity:{type:'string'},delivery:{type:'string'},vocabulary:{type:'string'},
  strengths:{type:'array',items:{type:'string'}},improvements:{type:'array',items:{type:'string'}},nextDrill:{type:'string'},interview:{type:'string'}
 },required:['overall','clarity','structure','relevance','specificity','delivery','vocabulary','strengths','improvements','nextDrill','interview']};
 const instructions=`You are the speaking coach inside STOP SCROLLING. Give useful coaching, not generic praise.
Evaluate the spoken response against the exact prompt. Focus on: whether it actually answered the question, clarity, logical structure, specificity, examples/evidence, concision, and natural spoken language.
Do not infer confidence, intelligence, personality, health, or competence from the transcript. Do not give numerical or meaningless overall scores. Never invent facts not present in the transcript.
Each feedback field must contain concrete observations from the response and one practical implication where useful.
For strengths and improvements return exactly 2 short, distinct items. Make them genuinely specific to this response.
If the prompt is an interview question, inspect for a STAR-like structure and put a concise observation in interview; otherwise return "Not an interview question."
Keep every string concise enough to scan on a phone.`;
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify({
  model:env.OPENAI_MODEL||'gpt-5.6-luna',instructions,input:`Prompt: ${String(prompt).slice(0,1000)}\nResponse transcript: ${String(transcript).slice(0,16000)}\nSpeaking duration: ${Number(durationSeconds)||0} seconds`,
  text:{format:{type:'json_schema',name:'speaking_coach',strict:true,schema}},max_output_tokens:1100
 })});
 if(!response.ok)throw new Error('AI analysis request failed');
 const data=await response.json(),raw=data.output_text||'';
 const ai=JSON.parse(raw);
 return{...base,...ai,source:'ai'};
}

async function api(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/api/health')return Response.json({ok:true,service:'stop-scrolling',platform:'cloudflare-worker',transcriptionConfigured:!!env.OPENAI_API_KEY,coachingConfigured:!!env.OPENAI_API_KEY});
 if(url.pathname==='/api/transcribe'&&request.method==='POST'){
  if(!env.OPENAI_API_KEY)return Response.json({error:'Transcription service is not configured'},{status:503});
  try{return await transcribe(request,env)}catch{return Response.json({error:'Transcription failed'},{status:502})}
 }
 if(url.pathname==='/api/sessions'&&request.method==='POST')return Response.json({ok:true,saved:false,message:'Local history is active; Supabase persistence will be connected next.'});
 if(url.pathname==='/api/analyze'&&request.method==='POST'){
  const body=await request.json().catch(()=>({}));if(!body.prompt||!body.transcript)return Response.json({error:'prompt and transcript are required'},{status:400});
  const fallback=instantAnalysis(body.prompt,body.transcript,body.durationSeconds);
  if(!env.OPENAI_API_KEY)return Response.json(fallback);
  try{return Response.json(await aiCoach(body.prompt,body.transcript,body.durationSeconds,env))}catch{return Response.json(fallback)}
 }
 return env.ASSETS.fetch(request);
}
export default{fetch:api};
