import "./globals.css";

export const metadata = {
  title: "Nästa kapitel",
  description: "Katso kappale läpi ennen tuntia — suomeksi selitys, ruotsiksi sanat."
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F3F4EE"
};

export default function RootLayout({ children }) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}
