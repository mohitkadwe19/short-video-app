"use client";
import { useState, useEffect } from "react";

interface Video {
  id: string;
  title: string;
  filePath: string;
  shorts?: string[];
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  // ✅ Fetch Videos from GraphQL
  useEffect(() => {
    async function fetchVideos() {
      try {
        const response = await fetch("/api/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              query {
                videos {
                  id
                  title
                  filePath
                  shorts
                }
              }
            `,
          }),
        });

        const data = await response.json();
        if (data.errors) {
          throw new Error(data.errors[0].message);
        }

        setVideos(data.data?.videos || []);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
      }
    }

    fetchVideos();
  }, []);

  // ✅ Handle Video Upload & Register in DB via GraphQL
  const handleUpload = async () => {
    if (!video) {
      alert("Please select a video first!");
      return;
    }
  
    setUploading(true);
    const formData = new FormData();
    formData.append("video", video);
  
    try {
      // 1️⃣ Upload Video to Server
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
  
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }
  
      const filePath = data.filePath;
  
      // 2️⃣ Register Video in MongoDB via GraphQL Mutation
      const graphQLResponse = await fetch("/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            mutation {
              addVideo(title: "${video.name}", filePath: "${filePath}") {
                id
                title
                filePath
              }
            }
          `,
        }),
      });
  
      const graphQLData = await graphQLResponse.json();
      if (graphQLData.errors) {
        throw new Error(graphQLData.errors[0].message);
      }
  
      // 3️⃣ Trigger Video Processing to Generate Shorts
      const processResponse = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: filePath }),
      });
  
      const processData = await processResponse.json();
      if (!processResponse.ok) {
        throw new Error(processData.error || "Processing failed");
      }
  
      alert("Video uploaded, added to DB, and processed successfully!");
      setVideos([...videos, { ...graphQLData.data.addVideo, shorts: processData.shortVideos }]); // Update UI
      setVideo(null); // Reset file input
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setUploading(false);
    }
  };  

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold">Uploaded Videos</h1>
      {error && <p className="text-red-500">{error}</p>}
      <input type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] || null)} />
      <button
        className="bg-blue-500 text-white px-4 py-2 mt-4"
        onClick={handleUpload}
        disabled={uploading}
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
      <ul className="mt-4">
        {videos.map((video) => (
          <li key={video.id} className="border p-2 mt-2">
            {video.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
