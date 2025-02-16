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

    const folderRelative = path.dirname(videoPath);

    const audioFileName = path.basename(audioPath);
    const putPath = `${folderRelative}/${audioFileName}`;
    const fileBuffer = fs.readFileSync(audioPath);
    const { url } = await put(putPath, fileBuffer, {
      access: "public",
    });

    const { text: transcriptText } = await transcribeAudio(url);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { keyMoments, captions } = await extractKeyMomentsFromTranscript(
      transcriptText || ""
    );

    const shortVideos = await generateShortClipsWithCaptions(
      videoPath,
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

async function extractAudio(videoPath: string): Promise<string> {
  const folder = path.dirname(videoPath);
  const audioPath = path.join(folder, "audio.mp3");

  return new Promise<string>((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec("libmp3lame")
      .on("end", () => resolve(audioPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

async function transcribeAudio(audioUrl: string) {
  const config = { audio: audioUrl };
  const transcript = await client.transcripts.transcribe(config);

  path.dirname(audioUrl);
  return { text: transcript.text };
}

async function extractKeyMomentsFromTranscript(transcript: string) {
  const prompt = `Identify 3 key sentences and their timestamps from this transcript.
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

async function getVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find((s) => s.codec_type === "video");
      if (!videoStream) return reject("No video stream found");
      resolve({ width: videoStream.width || 0, height: videoStream.height || 0 });
    });
  });
}

async function generateSrtSubtitles(
  timestamp: string,
  caption: string,
  outputFile: string
) {
  const [start, end] = timestamp.split("-").map(Number);
  const duration = end - start;
  const segmentLength = 4;
  const numSegments = Math.ceil(duration / segmentLength);

  const sentences = caption.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);

  let srtContent = "";
  let counter = 1;
  for (let i = 0; i < numSegments; i++) {
    const segStart = i * segmentLength;
    const segEnd = Math.min((i + 1) * segmentLength, duration);
    const sentence = i < sentences.length ? sentences[i] : sentences[sentences.length - 1];
    const startFormatted = new Date(segStart * 1000)
      .toISOString()
      .substr(11, 12)
      .replace(".", ",");
    const endFormatted = new Date(segEnd * 1000)
      .toISOString()
      .substr(11, 12)
      .replace(".", ",");
    srtContent += `${counter}\n${startFormatted} --> ${endFormatted}\n${sentence}\n\n`;
    counter++;
  }
  fs.writeFileSync(outputFile, srtContent, "utf-8");
}

async function generateShortClipsWithCaptions(
  videoPath: string,
  timestamps: string[],
  captions: string[]
) {
  const baseFolder = path.dirname(videoPath);
  const shortVideosDir = path.join(process.cwd(), "public", baseFolder, "short_videos");
  const captionsDir = path.join(process.cwd(), "public", baseFolder, "captions");

  if (!fs.existsSync(shortVideosDir)) fs.mkdirSync(shortVideosDir, { recursive: true });
  if (!fs.existsSync(captionsDir)) fs.mkdirSync(captionsDir, { recursive: true });

  const { height } = await getVideoDimensions(path.join(process.cwd(), "public", videoPath));
  const fontSize = Math.round(height / 20);
  const captionColor = "&H00FF00";

  const shortVideos: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const [start, end] = timestamps[i].split("-").map(Number);
    const duration = end - start;
    const outputClip = path.join(shortVideosDir, `clip_${i}.mp4`);
    const srtFile = path.join(captionsDir, `subtitle_${i}.srt`);

    await generateSrtSubtitles(timestamps[i], captions[i], srtFile);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(path.join(process.cwd(), "public", videoPath))
        .setStartTime(start)
        .setDuration(duration)
        .outputOptions(
          "-vf",
          `subtitles=${srtFile}:force_style='Fontsize=${fontSize},PrimaryColour=${captionColor},Alignment=5,MarginV=50'`
        )
        .output(outputClip)
        .on("end", () => {
          shortVideos.push(path.join(baseFolder, "short_videos", `clip_${i}.mp4`));
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
