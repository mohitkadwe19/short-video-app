import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  const { transcript } = await req.json();
  const srtPath = await generateSubtitles(transcript);
  return NextResponse.json({ srtPath });
}

async function generateSubtitles(transcript: string) {
  const srtContent = transcript
    .split('. ') 
    .map((line, index) => {
      const startTime = index * 3;
      const endTime = startTime + 3;
      return `${index + 1}\n00:00:${startTime},000 --> 00:00:${endTime},000\n${line}\n`;
    })
    .join('\n');

  const srtPath = path.join('public', 'subtitles.srt');
  fs.writeFileSync(srtPath, srtContent);
  return srtPath;
}
