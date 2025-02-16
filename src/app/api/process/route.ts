import { NextResponse } from "next/server";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { connectDB } from "../../../lib/mongodb";
import { Video } from "../../../models/Video";
import { AssemblyAI } from "assemblyai";
import { put } from "@vercel/blob";

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    await connectDB();
    const { videoPath } = await req.json();

    const absoluteVideoPath = path.join(process.cwd(), "public", videoPath);
    if (!fs.existsSync(absoluteVideoPath)) {
      return NextResponse.json(
        { error: "Video file not found" },
        { status: 404 }
      );
    }

    const audioPath = await extractAudio(absoluteVideoPath);

    const fileName = path.basename(audioPath, ".mp3") + ".txt";
    const fileBuffer = fs.readFileSync(audioPath);

    const { url } = await put(`upload/${fileName}`, fileBuffer, {
      access: "public",
    });

    const { text: transcriptText } = await transcribeAudio(url);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { keyMoments, captions } = await extractKeyMomentsFromTranscript(
      transcriptText || ""
    );

    const shortVideos = await generateShortClipsWithCaptions(
      absoluteVideoPath,
      keyMoments,
      captions
    );

    await Video.findOneAndUpdate(
      { filePath: videoPath },
      { shorts: shortVideos }
    );

    return NextResponse.json({
      message: "Short videos created with captions",
      shortVideos,
    });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: error }, { status: 500 });
  }
}

async function extractAudio(videoPath: string) {
  const audioPath = videoPath.replace(".mp4", ".mp3");

  return new Promise<string>((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec("libmp3lame")
      .on("end", () => resolve(audioPath))
      .on("error", reject)
      .run();
  });
}

async function transcribeAudio(audioPath: string) {
  const config = {
    audio_url: audioPath,
  };
  const transcript = await client.transcripts.transcribe(config);

  const transcriptPath = path.join(
    process.cwd(),
    "public",
    "transcripts",
    path.basename(audioPath, ".mp3")
  );
  if (!fs.existsSync(path.dirname(transcriptPath))) {
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  }

  fs.writeFileSync(transcriptPath, transcript.text || "", "utf-8");

  return { text: transcript.text };
}

async function extractKeyMomentsFromTranscript(transcript: string) {
  const prompt = `Identify key sentences and their timestamps from this transcript.
  Return output in the format:  
  start-end: caption text
  
  Example output:
  10-30: "Success is about discipline."
  40-70: "Hard work beats talent when talent is lazy."
  100-130: "Dream big, start small."

  Transcript:
  ${transcript}`;

  const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
  const response = await model.generateContent(prompt);
  const textResponse = response.response.text();

  const keyMoments: string[] = [];
  const captions: string[] = [];

  textResponse?.split("\n").forEach((line) => {
    const match = line.match(/^(\d+)-(\d+):\s*(.+)$/);
    if (match) {
      keyMoments.push(`${match[1]}-${match[2]}`);
      captions.push(match[3]);
    }
  });
  return { keyMoments, captions };
}

async function generateSrtSubtitles(
  timestamps: string[],
  captions: string[],
  outputFile: string
) {
  let srtContent = "";
  let counter = 1;

  for (let i = 0; i < timestamps.length; i++) {
    const [start, end] = timestamps[i].split("-").map(Number);
    const duration = end - start;
    const numCaptions = Math.min(captions.length, Math.floor(duration / 4));

    for (let j = 0; j < numCaptions; j++) {
      const segmentStart = start + j * 4;
      const segmentEnd = Math.min(segmentStart + 4, end);

      const startFormatted = new Date(segmentStart * 1000)
        .toISOString()
        .substr(11, 12)
        .replace(".", ",");

      const endFormatted = new Date(segmentEnd * 1000)
        .toISOString()
        .substr(11, 12)
        .replace(".", ",");

      srtContent += `${counter}\n${startFormatted} --> ${endFormatted}\n${captions[j]}\n\n`;
      counter++;
    }
  }

  fs.writeFileSync(outputFile, srtContent, "utf-8");
}

async function generateShortClipsWithCaptions(
  videoPath: string,
  timestamps: string[],
  captions: string[]
) {
  const outputDir = path.join(process.cwd(), "public", "short_videos");
  const subtitlesDir = path.join(process.cwd(), "public", "subtitles");

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(subtitlesDir))
    fs.mkdirSync(subtitlesDir, { recursive: true });

  const shortVideos: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const [start, end] = timestamps[i].split("-").map(Number);
    const duration = end - start;
    const outputClip = path.join(outputDir, `clip_${i}.mp4`);
    const srtFile = path.join(subtitlesDir, `subtitle_${i}.srt`);

    console.log(`srtFile`, srtFile);

    await generateSrtSubtitles([timestamps[i]], [captions[i]], srtFile);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .setStartTime(start)
        .setDuration(duration)
        .outputOptions(
          "-vf",
          `subtitles=${srtFile}:force_style='Fontsize=50,PrimaryColour=&HFFFFFF,Alignment=5,MarginV=50'`
        )
        .output(outputClip)
        .on("end", () => {
          console.log(`✅ Short video created: ${outputClip}`);
          shortVideos.push(`/short_videos/clip_${i}.mp4`);
          resolve();
        })
        .on("error", (err) => {
          console.error(`❌ FFmpeg error: ${err.message}`);
          reject(`FFmpeg error: ${err.message}`);
        })
        .run();
    });
  }

  return shortVideos;
}
