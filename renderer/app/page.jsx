'use client'

import Navbar from "../components/Navbar";
import ChatArea from "../components/ChatArea";

export default function Home() {
  return (
    <div className="bg-[#080b11] w-svw h-svh text-white flex overflow-x-hidden">
      <Navbar />
      <ChatArea />
    </div>
  );
}
