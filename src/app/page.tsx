"use client";
import { useState, useEffect, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Dialog } from "@headlessui/react";

interface Video {
  id: string;
  title: string;
  filePath: string;
  shorts?: string[];
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState("");

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
        if (data.errors) throw new Error(data.errors[0].message);
        setVideos(data.data?.videos || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unknown error occurred");
      }
    }
    fetchVideos();
  }, []);

  const handleUpload = async () => {
    if (!video) {
      alert("Please select a video first!");
      return;
    }

    setUploading(true);
    setProgress(10);
    const formData = new FormData();
    formData.append("video", video);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      setProgress(50);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");

      const filePath = data.filePath;

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

      setProgress(80);
      const graphQLData = await graphQLResponse.json();
      if (graphQLData.errors) throw new Error(graphQLData.errors[0].message);

      const processResponse = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: filePath }),
      });

      setProgress(100);
      const processData = await processResponse.json();
      if (!processResponse.ok) throw new Error(processData.error || "Processing failed");

      alert("Video uploaded and processed successfully!");

      setVideos([...videos, { ...graphQLData.data.addVideo, shorts: processData.shortVideos }]);
      setVideo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setVideo(acceptedFiles[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [] },
  });
  

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold text-center mb-6">Short Video Generator</h1>

      <div
        {...getRootProps()}
        className="border-2 border-dashed border-gray-300 p-10 rounded-lg text-center cursor-pointer hover:bg-gray-100 transition-all"
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <p className="text-lg text-gray-700">Drop the video here...</p>
        ) : (
          <p className="text-lg text-gray-500">Drag & drop a video file here, or click to browse</p>
        )}
      </div>

      {video && (
        <div className="mt-4">
          <p className="text-sm text-gray-700">Selected file: {video.name}</p>
          <button
            className="bg-blue-500 text-white px-4 py-2 mt-2 rounded-lg hover:bg-blue-600 transition-all"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? `Uploading... ${progress}%` : "Upload Video"}
          </button>
          {uploading && <div className="h-2 bg-blue-500 mt-2 rounded" style={{ width: `${progress}%` }}></div>}
        </div>
      )}

      {error && <p className="text-red-500 mt-4">{error}</p>}

      {/* Video List */}
      <h2 className="text-xl font-semibold mt-6">Uploaded Videos</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
        {videos.map((video) => (
          <div
            key={video.id}
            className="relative cursor-pointer border rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-all"
            onClick={() => {
              setSelectedVideo(video);
              setPlayingVideo(video.filePath);
            }}
          >
            <video src={video.filePath} className="w-full h-40 object-cover"></video>
            <p className="text-center p-2 font-semibold">{video.title}</p>
          </div>
        ))}
      </div>

      {/* Video Player Modal */}
      <Dialog open={!!selectedVideo} onClose={() => setSelectedVideo(null)} className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-75">
        {selectedVideo && (
          <div className="bg-white p-6 rounded-lg w-96">
            <video src={playingVideo || ""} controls className="w-full h-64 rounded-md"></video>
            
            {/* Short Videos Section */}
            {selectedVideo.shorts && selectedVideo.shorts.length > 0 && (
              <div className="mt-4">
                <h3 className="text-lg font-semibold text-black">Short Videos</h3>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {selectedVideo.shorts.map((short, index) => (
                    <button
                      key={index}
                      onClick={() => setPlayingVideo(short)}
                      className="bg-gray-200 text-black text-sm py-1 px-2 rounded hover:bg-gray-300 transition"
                    >
                      Short {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <button className="mt-4 bg-red-500 text-white px-4 py-2 rounded-lg w-full" onClick={() => setSelectedVideo(null)}>
              Close
            </button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
