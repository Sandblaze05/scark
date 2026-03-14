'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { X, User, Bell, Shield } from 'lucide-react'
import { motion } from 'framer-motion'

const WORK_FUNCTIONS = [
  '',
  'Engineering / Development',
  'Design / Creative',
  'Product / Management',
  'Sales / Marketing',
  'Research / Academia',
  'Finance / Accounting',
  'Operations / Admin',
  'Other',
]

const NAV_ITEMS = [
  { id: 'general', label: 'General', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Shield },
]

export default function Settings({ onClose, onProfileSaved }) {
  const [activeTab, setActiveTab] = useState('general')
  const BLANK = { fullName: '', displayName: '', workFunction: '', preferences: '', notifyOnComplete: false, selectedVoice: '' }
  const [profile, setProfile] = useState(BLANK)
  const [savedProfile, setSavedProfile] = useState(BLANK) // tracks last-saved snapshot
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Load profile from DB on mount
  useEffect(() => {
    const load = async () => {
      try {
        const data = await window.scark?.profile?.get?.()
        if (data) {
          const loaded = {
            fullName: data.fullName || '',
            displayName: data.displayName || '',
            workFunction: data.workFunction || '',
            preferences: data.preferences || '',
            notifyOnComplete: data.notifyOnComplete === 'true',
            selectedVoice: data.selectedVoice || '',
          }
          setProfile(loaded)
          setSavedProfile(loaded)
        }
      } catch (e) {
        console.warn('[Settings] Failed to load profile', e)
      }
    }
    load()
  }, [])

  const [availableVoices, setAvailableVoices] = useState([])

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        setAvailableVoices(voices)
      }
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [])

  const isDirty = JSON.stringify(profile) !== JSON.stringify(savedProfile)

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.scark?.profile?.set?.({
        fullName: profile.fullName,
        displayName: profile.displayName,
        workFunction: profile.workFunction,
        preferences: profile.preferences,
        notifyOnComplete: String(profile.notifyOnComplete),
        selectedVoice: profile.selectedVoice,
      })
      setSavedProfile({ ...profile })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      
      // Dispatch event for other components (like Chat) to refresh profile data
      window.dispatchEvent(new CustomEvent('scark:profileSaved', { detail: profile }))

      // Notify parent so Navbar can update the displayed name
      onProfileSaved?.({ ...profile })
    } catch (e) {
      console.warn('[Settings] Failed to save profile', e)
    } finally {
      setSaving(false)
    }
  }, [profile, onProfileSaved])

  const initials = profile.fullName
    ? profile.fullName.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'SR'

  return (
    <motion.div
      initial={{ backdropFilter: 'blur(0px)', backgroundColor: 'color-mix(in oklab, var(--color-black) 0%, transparent)' }}
      animate={{ backdropFilter: 'blur(8px)', backgroundColor: 'color-mix(in oklab, var(--color-black) 40%, transparent)' }}
      exit={{ backdropFilter: 'blur(0px)', backgroundColor: 'color-mix(in oklab, var(--color-black) 0%, transparent)' }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Fixed-size modal — same height for all tabs */}
      <motion.div
        initial={{ scale: '90%', opacity: 0 }}
        animate={{ scale: '100%', opacity: 1 }}
        exit={{ scale: '90%', opacity: 0 }}
        className="relative flex rounded-2xl overflow-hidden shadow-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-white/10"
        style={{ width: 840, height: 540 }}
      >

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 transition-colors"
        >
          <X size={18} />
        </button>

        {/* ── Left sidebar ── */}
        <div className="w-52 shrink-0 bg-zinc-50 dark:bg-background border-r border-zinc-200 dark:border-white/10 flex flex-col py-6 px-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white px-3 mb-5">Settings</h2>
          <nav className="flex flex-col gap-0.5 flex-1">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left w-full
                  ${activeTab === id
                    ? 'bg-zinc-900 dark:bg-white/10 text-white dark:text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-zinc-200 dark:hover:bg-white/5'}`}
              >
                <Icon size={15} className="shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Main content — fixed height, scrollable inside ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-8 py-7">

            {/* GENERAL */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Profile</h3>

                {/* Full name + display name */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Full name</label>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#fca5a5] flex items-center justify-center text-xs font-bold text-gray-900 shrink-0">
                        {initials}
                      </div>
                      <input
                        type="text"
                        value={profile.fullName}
                        onChange={e => setProfile(p => ({ ...p, fullName: e.target.value }))}
                        placeholder="Your full name"
                        className="flex-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">What should Scark call you?</label>
                    <input
                      type="text"
                      value={profile.displayName}
                      onChange={e => setProfile(p => ({ ...p, displayName: e.target.value }))}
                      placeholder="Display name"
                      className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
                    />
                  </div>
                </div>

                {/* Work function */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">What best describes your work?</label>
                  <select
                    value={profile.workFunction}
                    onChange={e => setProfile(p => ({ ...p, workFunction: e.target.value }))}
                    className="w-full appearance-none bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/40 transition-all cursor-pointer"
                  >
                    <option value="" className='text-black'>Select your work function</option>
                    {WORK_FUNCTIONS.filter(Boolean).map(f => (
                      <option key={f} value={f} className='text-black'>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Preferences */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    What personal preferences should Scark consider in responses?
                  </label>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                    Your preferences will apply to all your conversations.
                  </p>
                  <textarea
                    value={profile.preferences}
                    onChange={e => setProfile(p => ({ ...p, preferences: e.target.value }))}
                    placeholder="e.g. ask clarifying questions before giving detailed answers"
                    rows={4}
                    className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/40 transition-all resize-none placeholder-gray-400 dark:placeholder-gray-600"
                  />
                </div>
              </div>
            )}

            {/* NOTIFICATIONS */}
            {activeTab === 'notifications' && (
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-5">Notifications</h3>
                <div className="border-t border-zinc-200 dark:border-white/10 pt-5">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Response completions</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-sm">
                        Get notified when Scark has finished a response. Useful for long-running tasks.
                      </p>
                    </div>
                    <button
                      onClick={() => setProfile(p => ({ ...p, notifyOnComplete: !p.notifyOnComplete }))}
                      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200 mt-0.5 ${profile.notifyOnComplete ? 'bg-violet-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                      role="switch"
                      aria-checked={profile.notifyOnComplete}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${profile.notifyOnComplete ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                <div className="border-t border-zinc-200 dark:border-white/10 pt-5 mt-5">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Voice selection</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                        Choose the voice used for reading assistant messages aloud.
                      </p>
                    </div>
                    
                    <div className="relative">
                      <select
                        value={profile.selectedVoice}
                        onChange={e => setProfile(p => ({ ...p, selectedVoice: e.target.value }))}
                        className="w-full appearance-none bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500/40 transition-all cursor-pointer"
                      >
                        <option value="" className="text-black">Default System Voice</option>
                        {availableVoices.map(voice => (
                          <option key={voice.voiceURI} value={voice.voiceURI} className="text-black">
                            {voice.name} ({voice.lang})
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PRIVACY */}
            {activeTab === 'privacy' && (
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-5">Privacy</h3>
                <div className="border-t border-zinc-200 dark:border-white/10 pt-5 space-y-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Scark runs entirely on your device. Your conversations and profile data are stored locally in a SQLite database and are never sent to any external server without your explicit action.
                  </p>
                  <div className="bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10 p-4 text-sm space-y-2">
                    <p className="font-medium text-gray-800 dark:text-gray-100">Data stored locally:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-500 dark:text-gray-400">
                      <li>Chat sessions and messages</li>
                      <li>Your profile preferences</li>
                      <li>Knowledge base (crawled pages and chunks)</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Footer with Save button — always visible ── */}
          <div className="shrink-0 px-8 py-4 border-t border-zinc-200 dark:border-white/10 flex items-center justify-end gap-3">
            {saveSuccess && (
              <span className="text-xs text-green-500 mr-auto">✓ Changes saved</span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                isDirty
                  ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'
                  : 'bg-zinc-200 dark:bg-white/10 text-gray-400 dark:text-gray-500 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
