import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import {
  SquarePen,
  Search,
  FolderPlus,
  MoreHorizontal,
  Box,
  LayoutGrid,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Share,
  UserPlus,
  Pencil,
  Archive,
  Trash2,
  Sun,
  Moon
} from 'lucide-react';

const Navbar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenuId, setActiveMenuId] = useState(null);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef(null);

  // Prevent hydration mismatch
  useEffect(() => setMounted(true), []);

  const [chats, setChats] = useState([
    { id: 1, title: 'Interface Design Simplified', isPinned: true },
    { id: 2, title: 'C++17 Combinatorics Soluti...' },
    { id: 3, title: 'Code Validation Explanation' },
    { id: 4, title: 'Linear Search Analysis' },
    { id: 5, title: 'Billing App Tally Integration' },
    { id: 6, title: 'Team Communication and S...' },
    { id: 7, title: 'Eid Al-Fitr Story Prompt' },
  ]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const togglePin = (id) => {
    setChats(chats.map(c => c.id === id ? { ...c, isPinned: !c.isPinned } : c));
    setActiveMenuId(null);
  };

  const deleteChat = (id) => {
    setChats(chats.filter(c => c.id !== id));
    setActiveMenuId(null);
  };

  const renameChat = (id) => {
    const newName = prompt("Enter new chat name:");
    if (newName && newName.trim() !== '') {
      setChats(chats.map(c => c.id === id ? { ...c, title: newName } : c));
    }
    setActiveMenuId(null);
  };

  const filteredChats = chats.filter(chat =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`flex flex-col whitespace-nowrap h-screen bg-zinc-50 dark:bg-[#171717] border-r border-zinc-200 dark:border-transparent text-gray-800 dark:text-gray-200 transition-all duration-300 shrink-0 ${isCollapsed ? 'w-17.5' : 'w-65'} pt-2`}>

      {/* Top Header section */}
      <div className="flex items-center justify-between px-3 h-12 shrink-0">
        <div className={`flex items-center overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-[#202123] cursor-pointer">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-black dark:text-white pb-0.5" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2057 5.9847 5.9847 0 0 0 3.989-2.9 6.051 6.051 0 0 0-.7388-7.0732zM13.2599 22.3601a4.2988 4.2988 0 0 1-2.92-1.129 4.3144 4.3144 0 0 1-1.3976-1.745l.1764-.0933 6.643-3.8344c.1685-.0985.2755-.2743.2755-.4707V7.4727l1.91 1.103a4.288 4.288 0 0 1 2.1469 3.7314 4.311 4.311 0 0 1-2.1469 3.7271l-4.6873 2.7073v3.6186zm-8.8687-3.9c-.313-.8071-.341-1.7-.0809-2.5273a4.3172 4.3172 0 0 1 1.2585-1.9284l.1772.0933 6.6457 3.8344c.168.0985.3768.0985.5448 0l6.6322-3.829v2.2044a4.3013 4.3013 0 0 1-2.1469 3.7272l-4.6878 2.7081a4.303 4.303 0 0 1-4.2933-.0004l-3.337-1.9272v-1.923l-.7133-.361zm-1.8485-9.397A4.2952 4.2952 0 0 1 4.2913 5.372a4.3117 4.3117 0 0 1 4.2933 0l4.6878 2.7079v-2.203a4.294 4.294 0 0 1 2.1469-3.7272l-1.91-1.103a4.303 4.303 0 0 1-4.2938 0l-4.6878 2.7073A4.3087 4.3087 0 0 1 2.3789 7.482l.1638 1.581zm15.4262-1.879l-.1764-.1002-6.6434-3.8345c-.168-.098-.3763-.098-.5443 0L5.3411 6.958v-2.204a4.2894 4.2894 0 0 1 2.1469-3.7278 4.3184 4.3184 0 0 1 4.2938 0l4.6878 2.7073a4.3037 4.3037 0 0 1 2.1469 3.7277v1.923zM7.1852 6.9554v7.62l-6.6309-3.8282a4.295 4.295 0 0 1-2.1469-3.7278 4.3115 4.3115 0 0 1 2.1469-3.728l4.6878-2.7073a4.3056 4.3056 0 0 1 1.9431-.56l.0001 6.9313zm5.0746 5.0441-3.3235-1.9189V6.2415l3.3235 1.919 3.3236 1.9189v3.8396l-3.3236 1.919l3.3235-1.9189zM19.3496 15.174l-6.6315 3.8281v-7.62l6.6315 3.8282a4.306 4.306 0 0 1 2.1469 3.7278 4.3117 4.3117 0 0 1-2.1469 3.7278l-4.6878 2.7073a4.3068 4.3068 0 0 1-1.9443.5606V15.174z" />
            </svg>
          </div>
        </div>

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`p-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-md transition-colors text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white shrink-0 ${isCollapsed ? 'mx-auto' : ''}`}
          title={isCollapsed ? "Expand sidebar" : "Close sidebar"}
        >
          {isCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      {/* Main scrollable area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
        <div className="px-3 space-y-1">
          {/* New Chat Button */}
          {isCollapsed ? (
            <button 
              onClick={() => window.scark?.chat?.triggerNew?.()}
              className="w-full p-2 mb-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-md flex justify-center transition-colors text-gray-800 dark:text-gray-200"
            >
              <SquarePen size={20} />
            </button>
          ) : (
            <div 
              onClick={() => window.scark?.chat?.triggerNew?.()}
              className="flex items-center justify-between mb-4 group cursor-pointer hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg p-2 transition-colors"
            >
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200 font-medium">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
                <span className="text-sm font-semibold">New chat</span>
              </div>
              <div className="flex items-center text-xs text-gray-500 font-medium">
                <span>Ctrl + Shift + O</span>
              </div>
            </div>
          )}

          {/* Search */}
          {!isCollapsed && (
            <div className="relative mb-2 group">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 group-focus-within:text-black dark:group-focus-within:text-white" />
              <input
                type="text"
                placeholder="Search chats"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-200 dark:bg-[#202123] text-sm text-gray-800 dark:text-gray-200 rounded-lg pl-9 pr-3 py-2 outline-none focus:bg-zinc-300 dark:focus:bg-[#2f2f2f] transition-all placeholder-gray-500 dark:placeholder-gray-400"
              />
            </div>
          )}

          {isCollapsed && (
            <button className="w-full p-2 mb-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-md flex justify-center transition-colors text-gray-400 hover:text-gray-200">
              <Search size={20} />
            </button>
          )}
        </div>

        {/* Your Chats Section */}
        <div className="px-3 mt-6 mb-4">
          {!isCollapsed && <h3 className="text-xs font-semibold text-gray-500 mb-2 px-2">Your chats</h3>}
          {isCollapsed && <div className="h-px bg-gray-800 my-4 mx-2"></div>}

          <div className="space-y-0.5">
            {filteredChats.map((chat) => (
              <div
                key={chat.id}
                className={`flex items-center gap-2 w-full p-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg transition-colors text-sm text-gray-700 dark:text-gray-300 group cursor-pointer relative ${isCollapsed ? 'justify-center' : ''} ${activeMenuId === chat.id ? 'bg-zinc-200 dark:bg-[#202123]' : ''}`}
                title={chat.title}
              >
                {isCollapsed ? (
                  <MessageSquare size={20} className="shrink-0 text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200" />
                ) : (
                  <>
                    <span className="truncate flex-1 text-left relative z-10 group-hover:pr-8">{chat.title}</span>
                    <div className={`${activeMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} absolute right-0 flex items-center gap-2 bg-linear-to-l from-zinc-200 dark:from-[#202123] via-zinc-200 dark:via-[#202123] to-transparent pl-8 pr-2 py-1 transition-opacity duration-200 z-20 rounded-r-lg`}>
                      {chat.isPinned && <Pin size={14} className="text-gray-500 dark:text-gray-400 shrink-0" />}
                      <div className="relative" ref={activeMenuId === chat.id ? menuRef : null}>
                        <MoreHorizontal
                          size={14}
                          className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === chat.id ? null : chat.id);
                          }}
                        />
                        {activeMenuId === chat.id && (
                          <div className="absolute top-6 right-0 w-52 bg-white dark:bg-[#2f2f2f] border border-zinc-200 dark:border-gray-700 rounded-lg shadow-xl py-1 z-50 text-gray-700 dark:text-gray-300 cursor-default" onClick={e => e.stopPropagation()}>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-[#424242] flex items-center gap-3 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); }}>
                              <Share size={16} /> Share
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-[#424242] flex items-center gap-3 transition-colors" onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); }}>
                              <UserPlus size={16} /> Start a group chat
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-[#424242] flex items-center gap-3 transition-colors" onClick={(e) => { e.stopPropagation(); renameChat(chat.id); }}>
                              <Pencil size={16} /> Rename
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-[#424242] flex items-center gap-3 transition-colors" onClick={(e) => { e.stopPropagation(); togglePin(chat.id); }}>
                              {chat.isPinned ? <><PinOff size={16} /> Unpin chat</> : <><Pin size={16} /> Pin chat</>}
                            </button>
                            <div className="h-px bg-zinc-200 dark:bg-gray-700 my-1 mx-2"></div>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 dark:hover:bg-[#424242] text-red-500 dark:text-red-400 flex items-center gap-3 transition-colors" onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}>
                              <Trash2 size={16} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {chat.isPinned && !isCollapsed && activeMenuId !== chat.id && (
                      <Pin size={12} className="absolute right-2 text-gray-400 dark:text-gray-500 group-hover:hidden" />
                    )}
                  </>
                )}
              </div>
            ))}
            {filteredChats.length === 0 && !isCollapsed && (
              <div className="px-2 py-3 text-sm text-gray-500 text-center">
                No chats found
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User profile and Theme Mode Footer */}
      <div className="p-3 mt-auto border-t border-zinc-200 dark:border-white/10 flex flex-col gap-1">

        {mounted && (
          isCollapsed ? (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 mx-auto hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg transition-colors"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={20} className="text-yellow-400" /> : <Moon size={20} className="text-gray-700" />}
            </button>
          ) : (
            <div className="flex items-center gap-3 w-full p-2 rounded-lg">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="relative w-14 h-7 rounded-full cursor-pointer transition-colors duration-300 flex items-center shrink-0"
                style={{ backgroundColor: theme === 'dark' ? '#334155' : '#cbd5e1' }}
                title="Toggle Theme"
                aria-label="Toggle Theme"
              >
                {/* Track icons */}
                <Sun size={12} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-yellow-400 transition-opacity duration-300" style={{ opacity: theme === 'dark' ? 0.4 : 0 }} />
                <Moon size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-blue-300 transition-opacity duration-300" style={{ opacity: theme === 'dark' ? 0 : 0.4 }} />
                {/* Sliding knob */}
                <span
                  className="absolute top-0.5 w-6 h-6 rounded-full shadow-md flex items-center justify-center transition-all duration-300"
                  style={{
                    left: theme === 'dark' ? '2px' : 'calc(100% - 26px)',
                    backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
                  }}
                >
                  {theme === 'dark'
                    ? <Moon size={13} className="text-blue-300" />
                    : <Sun size={13} className="text-yellow-500" />
                  }
                </span>
              </button>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </div>
          )
        )}

        <button className={`flex items-center gap-3 w-full p-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg transition-colors text-sm text-gray-800 dark:text-gray-200 ${isCollapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-full bg-[#fca5a5] flex items-center justify-center text-xs font-bold shrink-0 text-gray-900">
            SR
          </div>
          {!isCollapsed && (
            <span className="font-semibold truncate flex-1 text-left">Sarang Rastogi</span>
          )}
        </button>
      </div>

    </div>
  );
};

export default Navbar;