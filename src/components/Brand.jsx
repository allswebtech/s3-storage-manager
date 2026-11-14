export default function Brand() {
    return (
        <div className='flex items-center gap-2 select-none min-w-0'>
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt='' aria-hidden='true' className='w-6 h-6 rounded-sm' />
            <h3 className='text-xl font-semibold text-gray-200 flex items-center gap-2'>
                <span>S3</span>
                <span className='bg-gradient-to-r from-orange-300 to-red-400 bg-clip-text text-transparent'>Manager</span>
            </h3>
        </div>
    )
}
