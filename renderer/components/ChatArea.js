import React from 'react'
import Chat from './Chat'

const ChatArea = () => {
  return (
    <div className="flex flex-1 flex-col pt-2 h-full gap-3 overflow-x-hidden w-full">
      <header className='flex items-center justify-between w-full px-4 py-1'>
        <h1 className='text-3xl text-gray-800 dark:text-gray-200 font-semibold tracking-tight'>Scark</h1>
      </header>

      <Chat />

    </div>
  )
}

export default ChatArea