import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { connectDB } from "../../../lib/mongodb";
import { Video } from "../../../models/Video";

export async function POST(req: Request) {
  try {
    await connectDB();

    const formData = await req.formData();
    const file = formData.get("video") as File;

    if (!file) {
      return NextResponse.json({ error: "No video uploaded" }, { status: 400 });
    }

    const filePath = `uploads/${file.name}`;
    const absolutePath = path.join(process.cwd(), "public", filePath);

    if (fs.existsSync(absolutePath)) {
      return NextResponse.json({ message: "File already exists", filePath });
    }

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absolutePath, buffer);

    // Save in DB
    const newVideo = new Video({ title: file.name, filePath });
    await newVideo.save();

    return NextResponse.json({ message: "Video uploaded successfully", filePath });
  } catch (error : unknown) {
    return NextResponse.json({ error: error }, { status: 500 });
  }
}
