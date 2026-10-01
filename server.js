import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import {fileURLToPath} from 'url';

const {Pool}=pg;
const app=express();
const port=process.env.PORT||3000;
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const OPENAI_MODEL=process.env.OPENAI_MODEL||'gpt-5.6-luna';

app.use(express.json({limit:'100kb'}));

async function initDb(){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions(
      id UUID PRIMARY KEY,
      device_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      transcript TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      filler_count INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_device_created_idx
      ON sessions(device_id,created_at DESC);
  `);
}

app.get('/api/health',async(_req,res)=>{
  let db='not_configured';
  if(pool){try{await pool.query('SELECT 1');db='ok'}catch{db='error'}}
  res.json({ok:true,service:'stop-scrolling',database:db});
});

app.post('/api/sessions',async(req,res)=>{
  const {deviceId,prompt,transcript,wordCount,fillerCount,durationSeconds}=req.body||{};
  if(!deviceId||!prompt||!transcript)return res.status(400).json({error:'deviceId, prompt and transcript are required'});
  if(!pool)return res.status(503).json({error:'database_not_configured'});
  const id=crypto.randomUUID();
  await pool.query(
    'INSERT INTO sessions(id,device_id,prompt,transcript,word_count,filler_count,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id,String(deviceId).slice(0,100),String(prompt).slice(0,500),String(transcript).slice(0,10000),Number(wordCount)||0,Number(fillerCount)||0,Number(durationSeconds)||0]
  );
  res.status(201).json({id,saved:true});
});

app.post('/api/analyze',async(req,res)=>{
  const {prompt,transcript,durationSeconds=45}=req.body||{};
  if(!prompt||!transcript)return res.status(400).json({error:'prompt and transcript are required'});
  const text=String(transcript).trim().slice(0,12000);
  const words=text?text.split(/\\s+/).filter(Boolean):[];
  const fillerMatches=text.toLowerCase().match(/\\b(um|uh|like|you know|actually|basically)\\b/g)||[];
  const wpm=Math.round(words.length/Math.max(Number(durationSeconds)||1,1)*60);
  const sentences=text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
  const hasStructure=/\\b(first|second|finally|because|however|for example|so|then|the main|my point)\\b/i.test(text);
  const heuristic={clarity:words.length>=35?'Good':'Needs more detail',structure:hasStructure?'Clear signposting':'Add a simple beginning-middle-end structure',vocabulary:new Set(words.map(w=>w.toLowerCase().replace(/[^a-z']/g,''))).size>=Math.max(12,words.length*.55)?'Varied':'Try more precise word choices',fillerCount:fillerMatches.length,wpm,wordCount:words.length,sentenceCount:sentences.length,tip:fillerMatches.length>2?'Replace filler words with a short pause.':wpm>170?'Slow down slightly and land your key points.':wpm<90?'Add a little more detail and energy.':'Keep your pace and focus on specific examples.'};
  if(!OPENAI_API_KEY)return res.json({...heuristic,source:'instant-analysis'});
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify({model:OPENAI_MODEL,input:[{role:'user',content:`You are a concise speaking coach. Analyze this spontaneous speaking response. Return ONLY valid JSON with keys: clarity, structure, vocabulary, strengths (array of 2 strings), improvements (array of 2 strings), nextDrill (string). Do not score the person. Prompt: ${String(prompt).slice(0,500)} Response: ${text}`}]})});
    if(!response.ok)throw new Error(`OpenAI ${response.status}`);
    const data=await response.json();
    const raw=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text||'';
    const ai=JSON.parse(raw.replace(/^```json\\s*|\\s*```$/g,''));
    return res.json({...heuristic,...ai,source:'ai'});
  }catch(error){console.error('AI analysis failed',error);return res.json({...heuristic,source:'instant-analysis'});}
});

app.get('/api/sessions',async(req,res)=>{
  const deviceId=String(req.query.deviceId||'').slice(0,100);
  if(!deviceId)return res.status(400).json({error:'deviceId is required'});
  if(!pool)return res.json({sessions:[]});
  const {rows}=await pool.query(
    'SELECT id,prompt,transcript,word_count,filler_count,duration_seconds,created_at FROM sessions WHERE device_id=$1 ORDER BY created_at DESC LIMIT 50',
    [deviceId]
  );
  res.json({sessions:rows});
});

app.use(express.static(path.join(__dirname,'dist')));
app.get(/.*/,(req,res)=>{
  if(req.path.startsWith('/api/'))return res.status(404).json({error:'not_found'});
  res.sendFile(path.join(__dirname,'dist','index.html'));
});

initDb().then(()=>app.listen(port,()=>console.log(`STOP SCROLLING server running on :${port}`)))
  .catch(err=>{console.error('Database initialization failed',err);process.exit(1)});
