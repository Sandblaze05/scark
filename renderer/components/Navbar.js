import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTheme } from 'next-themes';
import Settings from './Settings';
import {
  Search,
  MoreHorizontal,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Sun,
  Moon,
  SquarePen,
} from 'lucide-react';

const Navbar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chats, setChats] = useState([]);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [userProfile, setUserProfile] = useState({ fullName: 'Sarang Rastogi', initials: 'SR' });
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef(null);
  const renameInputRef = useRef(null);

  const normalizeChats = (list) => (list ?? []).map(chat => ({
    ...chat,
    isPinned: Boolean(chat.isPinned),
  }));

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let disposed = false;

    const loadChats = async () => {
      const list = await window.scark?.chat?.list?.();
      if (disposed) return;
      const normalized = normalizeChats(list);
      setChats(normalized);
    };

    const loadProfile = async () => {
      const data = await window.scark?.profile?.get?.();
      if (disposed || !data?.fullName) return;
      const initials = data.fullName.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
      setUserProfile({ fullName: data.fullName, initials });
    };

    loadChats();
    loadProfile();

    const removeSelected = window.scark?.chat?.onSelected?.((chatId) => {
      setActiveChatId(chatId);
    });

    const removeList = window.scark?.chat?.onListUpdated?.((updated) => {
      const normalized = normalizeChats(updated);
      setChats(normalized);
      if (normalized.length > 0 && !normalized.some(c => c.id === activeChatId)) {
        const nextId = normalized[0].id;
        setActiveChatId(nextId);
      }
    });

    return () => {
      disposed = true;
      if (removeSelected) removeSelected();
      if (removeList) removeList();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreateChat = async () => {
    await window.scark?.chat?.create?.({ title: 'New chat' });
    setActiveMenuId(null);
  };

  const handleSelectChat = (chatId) => {
    setActiveChatId(chatId);
    window.scark?.chat?.select?.(chatId); // just select — no touch so order doesn't change
  };

  const togglePin = async (chat) => {
    await window.scark?.chat?.pin?.(chat.id, !chat.isPinned);
    setActiveMenuId(null);
  };

  const deleteChat = async (chat) => {
    await window.scark?.chat?.remove?.(chat.id);
    setActiveMenuId(null);
  };

  const renameChat = async (chat) => {
    setRenamingChatId(chat.id);
    setRenamingValue(chat.title || '');
    setActiveMenuId(null);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const handleSaveRename = async (chatId) => {
    if (renamingValue.trim()) {
      await window.scark?.chat?.rename?.(chatId, renamingValue.trim());
    }
    setRenamingChatId(null);
  };

  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    // Hide empty chats. Use lastMessage as fallback if messageCount is not yet in data.
    let chatsWithMessages = chats.filter(chat =>
      (chat.messageCount !== undefined ? chat.messageCount > 0 : !!chat.lastMessage)
    );
    // Always keep pinned chats at top, then sort by updatedAt descending
    chatsWithMessages = [...chatsWithMessages].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return (b.updatedAt || b.lastActiveAt || '') > (a.updatedAt || a.lastActiveAt || '') ? 1 : -1;
    });
    if (!query) return chatsWithMessages;
    return chatsWithMessages.filter(chat => (chat.title || '').toLowerCase().includes(query));
  }, [chats, searchQuery]);

  return (
    <>
    <div className={`flex flex-col whitespace-nowrap h-screen bg-zinc-50 dark:bg-black border-r border-zinc-200 dark:border-white/5 text-gray-800 dark:text-gray-200 transition-all duration-300 shrink-0 ${isCollapsed ? 'w-17.5' : 'w-65'} pt-2`}>
      <div className="px-3 h-12 shrink-0">
        {!isCollapsed ? (
          <div className="flex items-center justify-between h-full">
            <div className="flex items-center gap-2 overflow-hidden transition-all duration-300 w-auto opacity-100">
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-black dark:text-white" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2057 5.9847 5.9847 0 0 0 3.989-2.9 6.051 6.051 0 0 0-.7388-7.0732z" />
                  <circle cx="9.5" cy="10" r="1.5" fill="white" className="dark:fill-black" />
                  <circle cx="14.5" cy="10" r="1.5" fill="white" className="dark:fill-black" />
                </svg>
              </div>
              <span className="text-sm font-bold tracking-widest text-gray-600 dark:text-gray-300">SCARK</span>
            </div>

            <button
              onClick={() => setIsCollapsed(true)}
              className="p-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-md transition-colors text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white shrink-0"
              title="Close sidebar"
            >
              <PanelLeftClose size={20} />
            </button>
          </div>
        ) : (
          <div className="relative h-full w-full flex items-center justify-center group/sidebar-brand">
            <div className="w-8 h-8 flex items-center justify-center text-black dark:text-white transition-opacity duration-150 group-hover/sidebar-brand:opacity-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2057 5.9847 5.9847 0 0 0 3.989-2.9 6.051 6.051 0 0 0-.7388-7.0732z" />
                <circle cx="9.5" cy="10" r="1.5" fill="white" className="dark:fill-black" />
                <circle cx="14.5" cy="10" r="1.5" fill="white" className="dark:fill-black" />
              </svg>
            </div>

            <button
              onClick={() => setIsCollapsed(false)}
              className="absolute inset-0 m-auto w-8 h-8 flex items-center justify-center rounded-md opacity-0 group-hover/sidebar-brand:opacity-100 bg-zinc-200 dark:bg-[#202123] text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white transition-all duration-150"
              title="Expand sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
        <div className="px-3 space-y-1">
          {isCollapsed ? (
            <button
              onClick={handleCreateChat}
              className="w-full p-2 mb-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-md flex justify-center transition-colors text-gray-800 dark:text-gray-200"
            >
              <SquarePen size={20} />
            </button>
          ) : (
            <div
              onClick={handleCreateChat}
              className="flex items-center justify-between mb-4 group cursor-pointer hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg p-2 transition-colors"
            >
              <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200 font-medium">
                <SquarePen className="w-5 h-5" />
                <span className="text-sm font-semibold">New chat</span>
              </div>
              <div className="flex items-center text-xs text-gray-500 font-medium">
                <span>Ctrl + Shift + O</span>
              </div>
            </div>
          )}

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

        <div className="px-3 mt-6 mb-4">
          {!isCollapsed && <h3 className="text-xs font-semibold text-gray-500 mb-2 px-2">Your chats</h3>}
          {isCollapsed && <div className="h-px bg-gray-800 my-4 mx-2" />}

          <div className="space-y-0.5">
            {filteredChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className={`flex items-center gap-2 w-full p-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg transition-colors text-sm text-gray-700 dark:text-gray-300 group cursor-pointer relative ${isCollapsed ? 'justify-center' : ''} ${activeMenuId === chat.id || activeChatId === chat.id ? 'bg-zinc-200 dark:bg-[#202123]' : ''}`}
                title={chat.title}
              >
                  {isCollapsed ? (
                  <MessageSquare size={20} className="shrink-0 text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200" />
                ) : (
                  <>
                    {renamingChatId === chat.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renamingValue}
                        onChange={(e) => setRenamingValue(e.target.value)}
                        onBlur={() => handleSaveRename(chat.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(chat.id)
                          if (e.key === 'Escape') setRenamingChatId(null)
                          e.stopPropagation()
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-zinc-100 dark:bg-[#2f2f2f] text-gray-800 dark:text-gray-200 text-sm px-2 py-0.5 rounded outline-none ring-1 ring-violet-400/50 mr-2"
                      />
                    ) : (
                      <span className="truncate flex-1 text-left relative z-10 group-hover:pr-8">{chat.title}</span>
                    )}
                    <div className={`${activeMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} absolute right-0 flex items-center gap-2 bg-linear-to-l from-zinc-200 dark:from-[#202123] via-zinc-200 dark:via-[#202123] to-transparent pl-8 pr-2 py-1 transition-opacity duration-200 z-20 rounded-r-lg`}>
                      {Boolean(chat.isPinned) ? <Pin size={14} className="text-gray-500 dark:text-gray-400 shrink-0" /> : null}
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
                          <div className="absolute top-6 right-0 w-48 bg-white dark:bg-[#2f2f2f] border border-zinc-200 dark:border-gray-700 rounded-xl shadow-xl py-1.5 z-50 text-gray-700 dark:text-gray-300 cursor-default" onClick={e => e.stopPropagation()}>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-[#3a3a3a] flex items-center gap-3 transition-colors rounded-lg mx-auto" onClick={() => renameChat(chat)}>
                              <Pencil size={14} className="opacity-70" /> Rename
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-[#3a3a3a] flex items-center gap-3 transition-colors" onClick={() => togglePin(chat)}>
                              {Boolean(chat.isPinned) ? <><PinOff size={14} className="opacity-70" /> Unpin</> : <><Pin size={14} className="opacity-70" /> Pin</>}
                            </button>
                            <div className="h-px bg-zinc-200 dark:bg-gray-700 my-1 mx-2" />
                            <button className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 dark:hover:bg-[#3a3a3a] text-red-500 dark:text-red-400 flex items-center gap-3 transition-colors" onClick={() => deleteChat(chat)}>
                              <Trash2 size={14} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {Boolean(chat.isPinned) && activeMenuId !== chat.id && (
                      <Pin size={12} className="absolute right-2 text-gray-400 dark:text-gray-500 group-hover:hidden" />
                    )}
                  </>
                )}
              </div>
            ))}
            {filteredChats.length === 0 && !isCollapsed && (
              <div className="px-2 py-3 text-sm text-gray-500 text-center">No chats found</div>
            )}
          </div>
        </div>
      </div>

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
                <Sun size={12} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-yellow-400 transition-opacity duration-300" style={{ opacity: theme === 'dark' ? 0.4 : 0 }} />
                <Moon size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-blue-300 transition-opacity duration-300" style={{ opacity: theme === 'dark' ? 0 : 0.4 }} />
                <span
                  className="absolute top-0.5 w-6 h-6 rounded-full shadow-md flex items-center justify-center transition-all duration-300"
                  style={{
                    left: theme === 'dark' ? '2px' : 'calc(100% - 26px)',
                    backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
                  }}
                >
                  {theme === 'dark' ? <Moon size={13} className="text-blue-300" /> : <Sun size={13} className="text-yellow-500" />}
                </span>
              </button>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </div>
          )
        )}

        <button
          className={`flex items-center gap-3 w-full p-2 hover:bg-zinc-200 dark:hover:bg-[#202123] rounded-lg transition-colors text-sm text-gray-800 dark:text-gray-200 ${isCollapsed ? 'justify-center' : ''}`}
          onClick={() => setShowSettings(true)}
          title="Profile & Settings"
        >
          <div className="w-8 h-8 rounded-full bg-[#fca5a5] flex items-center justify-center text-xs font-bold shrink-0 text-gray-900">{userProfile.initials}</div>
          {!isCollapsed && <span className="font-semibold truncate flex-1 text-left">{userProfile.fullName}</span>}
        </button>
      </div>
    </div>

    {showSettings && <Settings
      onClose={() => setShowSettings(false)}
      onProfileSaved={(p) => {
        const initials = p.fullName
          ? p.fullName.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
          : 'SR'
        setUserProfile({ fullName: p.fullName || 'Sarang Rastogi', initials })
      }}
    />}
  </>
  );
};

export default Navbar;
