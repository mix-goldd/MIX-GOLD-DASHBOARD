import Head from 'next/head';
import { Poppins, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';

const sans = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
      </Head>
      <main className={`${sans.variable} ${mono.variable}`}>
        <Component {...pageProps} />
      </main>
    </>
  );
}
