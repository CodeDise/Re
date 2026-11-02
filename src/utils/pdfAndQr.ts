export interface ProcessedArticle {
  url: string;
  isYoutube: boolean;
  title: string;
  authorOrChannel: string;
  tldrThreeSentences: string;
  bulletPoints: string[];
  timestampsBreakdown: string[];
  cleanParagraphs: string[];
  estimatedReadMinutes: number;
  wordCount: number;
  telegraphUrl: string;
}

/**
 * Generates a deterministic 21x21 QR matrix from a UPI URI string
 * so the simulator renders an authentic scannable-style QR graphic with zero external image dependencies.
 */
export function generateQrMatrix(data: string): boolean[][] {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  const drawFinder = (rowOffset: number, colOffset: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rowOffset + r][colOffset + c] = isBorder || isInner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Deterministic hash fill for payload cells
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= size - 8;
      const inBottomLeft = r >= size - 8 && c < 8;
      const isTiming = r === 6 || c === 6;
      if (inTopLeft || inTopRight || inBottomLeft || isTiming) continue;

      const mix = ((r * 31 + c * 17 + Math.abs(hash)) ^ (data.charCodeAt((r + c) % data.length) || 7)) & 3;
      matrix[r][c] = mix === 0 || mix === 2;
    }
  }

  return matrix;
}

/**
 * Generates a real valid minimal PDF 1.4 binary blob containing the CleanReader
 * extracted article, Gemini 3-sentence TL;DR, and bullet points so clicking
 * [📥 Export Clean PDF] downloads an actual .pdf file immediately.
 */
export function buildCleanPdfBlob(article: ProcessedArticle): { blob: Blob; filename: string } {
  const sanitizePdfText = (input: string) =>
    input
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  const wrapLines = (text: string, maxChars: number): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxChars) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const contentLines: Array<{ font: 'F1' | 'F2'; size: number; text: string; gap: number }> = [];

  for (const titleLine of wrapLines(article.title, 58)) {
    contentLines.push({ font: 'F2', size: 15, text: titleLine, gap: 20 });
  }
  contentLines.push({
    font: 'F1',
    size: 9,
    text: `Source: ${article.url.slice(0, 72)} | Author: ${article.authorOrChannel} | Est. Read: ${article.estimatedReadMinutes} min`,
    gap: 18,
  });
  contentLines.push({ font: 'F2', size: 11, text: 'Gemini AI 3-Sentence TL;DR:', gap: 18 });
  for (const line of wrapLines(article.tldrThreeSentences, 82)) {
    contentLines.push({ font: 'F1', size: 10, text: line, gap: 14 });
  }

  contentLines.push({ font: 'F2', size: 11, text: 'Key Takeaways:', gap: 18 });
  for (const bp of article.bulletPoints) {
    for (const line of wrapLines(`- ${bp}`, 80)) {
      contentLines.push({ font: 'F1', size: 10, text: line, gap: 14 });
    }
  }

  if (article.timestampsBreakdown.length > 0) {
    contentLines.push({ font: 'F2', size: 11, text: 'Timestamps Breakdown:', gap: 18 });
    for (const ts of article.timestampsBreakdown) {
      for (const line of wrapLines(ts, 80)) {
        contentLines.push({ font: 'F1', size: 10, text: line, gap: 14 });
      }
    }
  }

  contentLines.push({ font: 'F2', size: 11, text: 'Clean Reader Extracted Text:', gap: 20 });
  for (const para of article.cleanParagraphs) {
    for (const line of wrapLines(para, 82)) {
      contentLines.push({ font: 'F1', size: 10, text: line, gap: 14 });
    }
    contentLines.push({ font: 'F1', size: 10, text: '', gap: 8 });
  }

  let y = 790;
  const streamCommands: string[] = ['BT'];
  for (const item of contentLines) {
    if (y < 55) break;
    y -= item.gap;
    streamCommands.push(`/${item.font} ${item.size} Tf`);
    streamCommands.push(`1 0 0 1 48 ${y} Tm`);
    streamCommands.push(`(${sanitizePdfText(item.text)}) Tj`);
  }
  streamCommands.push('ET');
  const streamBody = streamCommands.join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const slug =
    article.title
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'Article';

  return {
    blob: new Blob([pdf], { type: 'application/pdf' }),
    filename: `CleanReader_${slug}.pdf`,
  };
}
