declare module 'react-dom/client' {
    export interface Root {
        render(children: unknown): void;
        unmount(): void;
    }

    export function createRoot(container: Element | DocumentFragment): Root;
}
