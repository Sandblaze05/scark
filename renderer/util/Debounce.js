export default function useDebounce(callback, delay) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(callback);
}