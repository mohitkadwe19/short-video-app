import { NextResponse } from "next/server";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { connectDB } from "../../../lib/mongodb";
import { Video } from "../../../models/Video";
import { AssemblyAI } from "assemblyai";
import { upload } from '@vercel/blob/client';

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const client = new AssemblyAI({
  apiKey: "a6921ce191fe40039549725e5da80e34",
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

    // 1️⃣ Extract Audio from Video
    const audioPath = await extractAudio(absoluteVideoPath);

    // 2️⃣ Transcribe Audio to Text using Gemini AI
    const { text: transcriptText , transcriptPath } = await transcribeAudio(
      audioPath
    );

    await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay

    console.log("Transcript:", transcriptText);
    console.log("Transcript Path:", transcriptPath);

    // 3️⃣ Extract Key Moments & Captions from the Transcript
    const { keyMoments, captions } = await extractKeyMomentsFromTranscript(
      transcriptText || ""
    );

    console.log("Key Moments:", keyMoments);
    console.log("Captions:", captions);

    // 4️⃣ Generate Short Clips with Captions Overlay
    const shortVideos = await generateShortClipsWithCaptions(
      absoluteVideoPath,
      keyMoments,
      captions
    );

    // 5️⃣ Update MongoDB with Generated Shorts
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

// ✅ **Extract Audio from Video**
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

// ✅ **Transcribe Audio using Gemini AI**
async function transcribeAudio(audioPath: string) {
  const config = {
    audio_url: "https://assembly.ai/sports_injuries.mp3",
  };
  const transcript = await client.transcripts.transcribe(config);

  // Save transcript to a file
  const transcriptPath = path.join(
    process.cwd(),
    "public",
    "transcripts",
    path.basename(audioPath, ".mp3") + ".txt"
  );
  if (!fs.existsSync(path.dirname(transcriptPath))) {
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  }

  fs.writeFileSync(transcriptPath, transcript.text || "", "utf-8");

  // upload to vercel
  const { url } = await upload(path.basename(audioPath, ".mp3") + ".txt", transcriptPath, {
    access: 'public',
    handleUploadUrl: '/upload',
  });
  console.log(`Uploaded to ${url}`);

  return { text: transcript.text, transcriptPath };
}

// ✅ **Extract Key Moments & Captions from Transcript**
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
  return {
    keyMoments:
      keyMoments.length > 0 ? keyMoments : ["0-30", "40-70", "90-120"],
    captions:
      captions.length > 0
        ? captions
        : [
            "Runner's knee is a condition characterized by pain behind or around the kneecap",
            "Symptoms include pain under or around the kneecap, pain when walking",
            "The ligaments of the ankle holds the ankle bones and joint in position.",
          ],
  };
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
    const numCaptions = Math.min(captions.length, Math.floor(duration / 4)); // Adjust frequency

    for (let j = 0; j < numCaptions; j++) {
      const segmentStart = start + j * 4; // Every 4 seconds
      const segmentEnd = Math.min(segmentStart + 4, end);

      // Convert to SRT time format
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
  console.log(`✅ SRT subtitles created: ${outputFile}`);
}


async function generateShortClipsWithCaptions(
  videoPath: string,
  timestamps: string[],
  captions: string[]
) {
  const outputDir = path.join(process.cwd(), "public", "short_videos");
  const subtitlesDir = path.join(process.cwd(), "public", "subtitles");

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(subtitlesDir)) fs.mkdirSync(subtitlesDir, { recursive: true });

  const shortVideos: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const [start, end] = timestamps[i].split("-").map(Number);
    const duration = end - start;
    const outputClip = path.join(outputDir, `clip_${i}.mp4`);
    const srtFile = path.join(subtitlesDir, `subtitle_${i}.srt`);

    console.log(`srtFile`, srtFile);

    // ✅ Generate SRT Subtitle
    await generateSrtSubtitles([timestamps[i]], [captions[i]], srtFile);

    // ✅ Generate Short Clip with Subtitles
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .setStartTime(start)
        .setDuration(duration)
        .outputOptions(
          "-vf",
          `subtitles=${srtFile}:force_style='Fontsize=50,PrimaryColour=&HFFFFFF,Alignment=5,MarginV=50'`
        ) // Ensures text is centered
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
