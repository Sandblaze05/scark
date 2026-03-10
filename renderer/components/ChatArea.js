import React from 'react'
import { User } from 'lucide-react'
import Chat from './Chat'

const ChatArea = () => {
  return (
    <div className="flex flex-col px-4 pt-2 w-full max-w-[80svw] h-full gap-3 overflow-x-hidden">
      <header className='flex items-center justify-between w-full px-2 py-1'>
        <h1 className=' text-3xl'>Scark</h1>
        <div className='flex items-center justify-center '>
          <span className=' rounded-full border-0 border-white overflow-hidden w-8 h-8 flex items-center justify-center bg-linear-130 from-gray-700 via-gray-500 to-gray-100'>
            <User className='fill-white w-6 h-6' />
          </span>
        </div>
      </header>

      <Chat />

    </div>
  )
}

export default ChatArea