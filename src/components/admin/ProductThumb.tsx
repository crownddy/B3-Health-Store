import Image from "next/image";

/**
 * Product image thumbnail for the Inventory list.
 *
 * Shows the stored image when there is one, and a clean "B3" placeholder
 * otherwise. The image is only ever read from `products.image_url` — no URL is
 * invented or rewritten. `unoptimized` keeps the request on the stored URL, so
 * it works with any Supabase project host without extra Next.js config.
 */
export default function ProductThumb({
  src,
  alt,
  size = 44
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  return (
    <span className="admin-thumb" style={{ width: size, height: size }}>
      {src ? (
        <Image src={src} alt={alt} width={size} height={size} unoptimized />
      ) : (
        <span className="admin-thumb-placeholder" aria-hidden="true">
          B3
        </span>
      )}
    </span>
  );
}
