'use client'

import Navbar from "../components/Navbar";
import ChatArea from "../components/ChatArea";

export default function Home() {
  return (
    <div className="bg-background w-svw h-svh text-foreground flex overflow-x-hidden transition-colors duration-300">
      <Navbar />
      <ChatArea />
    </div>
  );
}
