import { useEffect, useId, useRef, useState } from 'react'

/**
 * Shared modal shell: overlay, dialog semantics, Escape to close (unless `busy`), focus moved into the
 * dialog when it opens and back to the previously focused element when it closes.
 */
export default function Modal({ onClose, busy = false, title, titleClassName = '', overlayClassName = 'bg-[#000]/50', className = 'w-full max-w-lg card p-5', children, labelledBy }) {
    const dialogRef = useRef(null)
    const autoId = useId()
    const titleId = labelledBy || `${autoId}-title`
    const onCloseRef = useRef(onClose)
    const busyRef = useRef(busy)
    // Captured during the first render, before autoFocus inside the dialog moves focus.
    const [previouslyFocused] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))

    useEffect(() => {
        onCloseRef.current = onClose
        busyRef.current = busy
    })

    useEffect(() => {
        const el = dialogRef.current
        if (el && !el.contains(document.activeElement)) el.focus()
        function onKey(e) {
            if (e.key === 'Escape' && !busyRef.current) {
                e.stopPropagation()
                onCloseRef.current?.()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('keydown', onKey)
            if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
                previouslyFocused.focus()
            }
        }
    }, [previouslyFocused])

    return (
        <div className={`w-full h-full fixed top-0 left-0 ${overlayClassName} backdrop-blur-sm flex items-center justify-center px-2 z-50`}>
            <div
                ref={dialogRef}
                role='dialog'
                aria-modal='true'
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`${className} outline-none`}
            >
                {title != null && <h1 id={titleId} className={titleClassName}>{title}</h1>}
                {children}
            </div>
        </div>
    )
}
