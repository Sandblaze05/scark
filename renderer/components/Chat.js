'use client'

import React, { useRef, useCallback } from 'react'
import gsap from 'gsap'

const Chat = () => {
  const textareaRef = useRef(null)
  const MAX_HEIGHT = 200

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    const currentHeight = el.offsetHeight

    el.style.height = 'auto'

    const newHeight = Math.min(el.scrollHeight, MAX_HEIGHT)

    // restore current height before animating
    el.style.height = `${currentHeight}px`

    gsap.killTweensOf(el)

    gsap.to(el, {
      height: newHeight,
      duration: 0.2,
      ease: 'power2.out'
    })

    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  return (
    <div className="flex flex-col-reverse w-full h-full">
      <div className="grid grid-rows-[auto_auto] grid-cols-1 py-5 px-7 w-2xl outline outline-white/20 rounded-4xl mx-auto bg-linear-270 from-[#38353c]/30 to-[#5a5561]/30">
        <textarea
          ref={textareaRef}
          onInput={handleInput}
          rows={1}
          placeholder='Ask here...'
          className="mx-auto w-full resize-none overflow-hidden bg-transparent outline-none scroll-smooth leading-5"
          style={{ minHeight: '2.5rem' }}
        />
        <div className="h-10"></div>
      </div>
    </div>
  )
}

export default Chat