import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-hangar px-6">
      <div className="max-w-md">
        <div className="display grad-text text-[96px] leading-none font-bold tracking-[-0.05em]">404</div>
        <h1 className="mt-4 text-[28px] font-bold tracking-[-0.03em]">This page isn&apos;t here</h1>
        <p className="mt-2 text-[15px] text-mute">The link may be old, or the product, module or run was deleted.</p>
        <Link href="/workspaces" className="grad mt-6 inline-flex h-11 items-center rounded-full px-5 font-semibold text-ink">
          Back to workspaces
        </Link>
      </div>
    </div>
  );
}
