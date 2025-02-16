import { NextRequest } from "next/server";
import { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { connectDB } from "../../../lib/mongodb";
import { Video } from "../../../models/Video";
import { gql } from "graphql-tag";

await connectDB();

const typeDefs = gql`
  type Video {
    id: ID!
    title: String!
    filePath: String!
    shorts: [String]
  }
 
  type Query {
    videos: [Video]
  }

  type Mutation {
    addVideo(title: String!, filePath: String!): Video
  }
`;

interface VideoArgs {
  title: string;
  filePath: string;
}

const resolvers = {
  Query: {
    videos: async () => {
      await connectDB();
      return await Video.find();
    },
  },
  Mutation: {
    addVideo: async (_: unknown, { title, filePath }: VideoArgs) => {
      await connectDB();
      const existingVideo = await Video.findOne({ filePath });

      if (existingVideo) {
        return existingVideo;
      }

      const video = new Video({ title, filePath });
      await video.save();
      return video;
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });
const handler = startServerAndCreateNextHandler(server);

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}
