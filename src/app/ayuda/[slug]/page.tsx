import ArticuloClient from "./ArticuloClient";

type PageProps = { params: Promise<{ slug: string }> };

/** Artículo de la Ayuda en línea. */
export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  return <ArticuloClient slug={slug} />;
}
