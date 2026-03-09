'use client'

import Navbar from "../components/Navbar";
import ChatArea from "../components/ChatArea";

export default function Home() {
  return (
    <div className="bg-[#11151c] w-svw h-svh text-white flex">
      <Navbar />
      <ChatArea />
    </div>
  );
}
