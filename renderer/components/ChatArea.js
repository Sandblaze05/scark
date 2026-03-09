import React from 'react'
import { User } from 'lucide-react'

const ChatArea = () => {
  return (
    <div className="flex flex-col items-start px-4 py-2 w-full h-full bg-[#080b11]">
      <div className='flex items-center justify-between w-full'>
        <h1 className=' text-3xl'>Scark</h1>
        <div className='flex items-center justify-center '>
          <User className='fill-white bg-linear-130 from-blue-500 to-blue-100  w-8 h-8 rounded-full border-2 border-white' />
        </div>
      </div>
    </div>
  )
}

export default ChatArea