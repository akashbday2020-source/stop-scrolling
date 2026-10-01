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
app.get('*',(req,res)=>{
  if(req.path.startsWith('/api/'))return res.status(404).json({error:'not_found'});
  res.sendFile(path.join(__dirname,'dist','index.html'));
});

initDb().then(()=>app.listen(port,()=>console.log(`STOP SCROLLING server running on :${port}`)))
  .catch(err=>{console.error('Database initialization failed',err);process.exit(1)});
