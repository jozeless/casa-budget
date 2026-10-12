import '../_shared/receipt-core.js';
import {createHandler} from '../_shared/extractor.mjs';
import {createPdfValidator} from '../_shared/pdf-validation.mjs';
import {PDFDocument,PDFDict,PDFArray,PDFStream,PDFName} from 'npm:pdf-lib@1.17.1';
// get-user verifies JWT server-side; no unverified JWT decoding or secrets in the PWA.
Deno.serve(createHandler({env:(name:string)=>Deno.env.get(name),core:(globalThis as any).CASA_RECEIPTS,validatePdf:createPdfValidator({PDFDocument,PDFDict,PDFArray,PDFStream,PDFName})}));
