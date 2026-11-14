import { Folder, LoaderCircle, House, EllipsisVertical, Info, Image as ImageIcon, Video as VideoIcon, Music as MusicIcon, FileText, Code, Archive } from 'lucide-react'
import { toast } from 'react-toastify'
import deleteFileOrFolder from '../api/deleteFileOrFolder'
import getFilePreview from '../api/getFilePreview'
import { describeS3Error } from '../api/s3Client'
import useCredentials from '../hooks/useCredentials'
import { useState, useEffect } from 'react'
import DeleteConfirmModal from './modals/DeleteConfirmModal'
import { fileCategory } from '../helpers/mimeGuess'
import { openInNewTab } from '../helpers/url'

const MENU_ITEM = 'block w-full text-left px-3 py-2 text-xs hover:bg-[#232323]'

function FileIcon({ item }) {
    if (item.type === 'folder') return <Folder size={18} className='text-yellow-500' aria-hidden='true' />
    switch (fileCategory(item.name)) {
        case 'image': return <ImageIcon size={18} className='text-pink-400' aria-hidden='true' />
        case 'video': return <VideoIcon size={18} className='text-purple-400' aria-hidden='true' />
        case 'audio': return <MusicIcon size={18} className='text-green-400' aria-hidden='true' />
        case 'document': return <FileText size={18} className='text-blue-400' aria-hidden='true' />
        case 'code': return <Code size={18} className='text-cyan-400' aria-hidden='true' />
        case 'archive': return <Archive size={18} className='text-orange-400' aria-hidden='true' />
        default: return <FileText size={18} className='text-gray-400' aria-hidden='true' />
    }
}

// Path of an item shown under its name in search/filter results; each folder segment is clickable.
function ItemPath({ item, onNavigate }) {
    const parts = item.key.replace(/\/$/, '').split('/').filter(Boolean)
    parts.pop()
    return (
        <span className='block text-[10px] font-mono ml-1 break-words'>
            <button type='button' aria-label='Go to bucket root' onClick={() => onNavigate('')} className='inline align-middle text-blue-400 hover:underline mr-1'>
                <House size={12} aria-hidden='true' />
            </button>
            {parts.map((part, idx) => {
                const prefix = parts.slice(0, idx + 1).join('/') + '/'
                return (
                    <span key={prefix}>
                        <span className='text-gray-400'> / </span>
                        <button type='button' className='text-blue-400 hover:underline' onClick={() => onNavigate(prefix)}>{part}</button>
                    </span>
                )
            })}
        </span>
    )
}

export default function Finder({ contents = [], setCurrentDirectory, onRename, onDelete, onOpenInfo, onCopy, onMove, onPreview, onDownloadFolder, showItemPath = false, loading = false, selectedKeys = new Set(), onToggleSelect, onToggleSelectAll, onSelectFromContext }) {

    const { s3, credentials } = useCredentials()
    const [deletingKey, setDeletingKey] = useState(null)
    const [deleteTarget, setDeleteTarget] = useState(null) // { key, type, name }
    const [openMenuKey, setOpenMenuKey] = useState(null)

    // Close the context menu on outside click or when pressing Escape
    useEffect(() => {
        if (openMenuKey == null) return undefined
        function handleDocumentClick() {
            setOpenMenuKey(null)
        }
        function handleKeyDown(e) {
            if (e.key === 'Escape') setOpenMenuKey(null)
        }
        document.addEventListener('click', handleDocumentClick)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('click', handleDocumentClick)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [openMenuKey])

    async function handleDeleteFileOrFolder({ key, name }) {
        if (!s3 || !credentials) return
        setDeletingKey(key)
        try {
            await deleteFileOrFolder(s3, key, credentials.name)
            toast.success(`Deleted ${name}`)
        } catch (err) {
            toast.error(`Could not delete ${name}: ${describeS3Error(err)}`, { autoClose: 10000 })
        } finally {
            setDeletingKey(null)
            setDeleteTarget(null)
            // Refresh even after a partial failure so the list shows what is really left.
            onDelete?.()
        }
    }

    async function handleFileDownload(item) {
        try {
            const url = await getFilePreview(s3, item.key, true, credentials.name, credentials.publicUrl)
            openInNewTab(url)
        } catch (err) {
            toast.error(`Download failed: ${describeS3Error(err)}`)
        }
    }

    function openItem(item) {
        if (item.type === 'folder') setCurrentDirectory(item.key)
        else onPreview?.(item)
    }

    function menuAction(fn) {
        return () => {
            setOpenMenuKey(null)
            fn()
        }
    }

    const selectedCount = contents.reduce((n, c) => n + (selectedKeys.has(c.key) ? 1 : 0), 0)
    const allSelected = contents.length > 0 && selectedCount === contents.length

    return (
        <>
            <div className='divide-y divide-[#252525]'>
                {/* Header row with select all when there are contents */}
                {!loading && contents.length > 0 && (
                    <div className='flex items-center justify-between px-3 sm:px-4 py-2 bg-[#0f0f0f] md:sticky md:top-[67px] md:z-10'>
                        <label className='inline-flex items-center gap-2 text-xs text-gray-300'>
                            <input
                                type='checkbox'
                                checked={allSelected}
                                ref={el => {
                                    if (el) el.indeterminate = selectedCount > 0 && !allSelected
                                }}
                                onChange={() => onToggleSelectAll?.()}
                            />
                            Select all
                        </label>
                        <span className='text-[11px] text-gray-500 font-mono'>Items: {contents.length}</span>
                    </div>
                )}
                {loading ? (
                    <div className='flex items-center justify-center py-8'>
                        <LoaderCircle size={22} className='animate-spin text-yellow-400' aria-label='Loading' />
                    </div>
                ) : contents.length > 0 ? (
                    contents.map((content) => (
                        <div key={content.key} data-testid='finder-row' data-key={content.key} className={`relative flex items-center justify-between px-3 sm:px-4 py-3 hover:bg-[#0f0f0f] transition-colors ${selectedKeys.has(content.key) ? 'bg-[#0c0c0c]' : ''}`}>
                            <span className='flex items-center gap-3 min-w-0'>
                                <input
                                    type='checkbox'
                                    aria-label={`Select ${content.name}`}
                                    checked={selectedKeys.has(content.key)}
                                    onChange={() => onToggleSelect?.(content)}
                                />
                                <FileIcon item={content} />

                                <div className='min-w-0'>
                                    <button
                                        type='button'
                                        className='block text-left text-yellow-500 cursor-pointer text-xs font-mono truncate max-w-[55vw] sm:max-w-none'
                                        onClick={() => openItem(content)}
                                    >
                                        {content.name}
                                    </button>
                                    {/* Show path only when searching/filtering, because items can be from different folders */}
                                    {showItemPath && content.key.split('/').filter(Boolean).length > 1 && (
                                        <ItemPath item={content} onNavigate={setCurrentDirectory} />
                                    )}
                                </div>
                            </span>
                            <div className='flex items-center gap-4 ml-3 flex-shrink-0'>
                                <button type='button' aria-label={`Details of ${content.name}`} onClick={() => onOpenInfo?.(content)} className='text-blue-300 cursor-pointer'>
                                    <Info size={18} aria-hidden='true' />
                                </button>
                                <button
                                    type='button'
                                    aria-label={`Actions for ${content.name}`}
                                    aria-haspopup='menu'
                                    aria-expanded={openMenuKey === content.key}
                                    className='text-gray-300 cursor-pointer'
                                    onClick={(e) => { e.stopPropagation(); setOpenMenuKey((k) => k === content.key ? null : content.key) }}
                                >
                                    <EllipsisVertical size={18} aria-hidden='true' />
                                </button>
                                {deletingKey === content.key && (
                                    <LoaderCircle size={18} className='text-yellow-300 animate-spin' aria-label='Deleting' />
                                )}
                            </div>
                            {openMenuKey === content.key && (
                                <div role='menu' className='absolute right-4 top-full mt-1 w-44 bg-[#181818] border border-[#232323] rounded-md shadow-lg z-40'
                                    onClick={(e) => e.stopPropagation()}>
                                    {content.type === 'folder' ? (
                                        <div>
                                            <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => setCurrentDirectory(content.key))}>Open</button>
                                            <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => onDownloadFolder?.(content))}>Download as ZIP</button>
                                        </div>
                                    ) : (
                                        <div>
                                            <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => onPreview?.(content))}>Preview</button>
                                            <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => handleFileDownload(content))}>Download</button>
                                        </div>
                                    )}
                                    <div className='border-t border-[#232323]' />
                                    <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => onSelectFromContext?.(content))}>{selectedKeys.has(content.key) ? 'Deselect' : 'Select'}</button>
                                    <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => onCopy?.(content))}>Copy to…</button>
                                    <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => onMove?.(content))}>Move to…</button>
                                    <button type='button' role='menuitem' className={MENU_ITEM} onClick={menuAction(() => onRename?.(content))}>Rename</button>
                                    <div className='border-t border-[#232323]' />
                                    <button type='button' role='menuitem' className={`${MENU_ITEM} text-red-300`} onClick={menuAction(() => setDeleteTarget({ key: content.key, type: content.type, name: content.name }))}>Delete</button>
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    <div className='flex items-center justify-center py-10 text-sm text-gray-500 font-mono '>
                        No files or folders in this directory.
                    </div>
                )}
            </div>
            <DeleteConfirmModal
                isOpen={deleteTarget != null}
                handleClose={() => setDeleteTarget(null)}
                onConfirm={() => deleteTarget && handleDeleteFileOrFolder(deleteTarget)}
                type={deleteTarget?.type}
                name={deleteTarget?.name}
            />
        </>
    )
}
