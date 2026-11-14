import Brand from './Brand'

export default function SimpleHeader() {
    return (
        <div className='bg-[#181818] w-full p-4 border-b border-[#202020] sticky top-0 z-20'>
            <div className='w-full max-w-6xl mx-auto flex items-center'>
                <Brand />
            </div>
        </div>
    )
}
