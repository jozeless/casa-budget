export function createPdfValidator({PDFDocument,PDFDict,PDFArray,PDFStream,PDFName}){
 return async bytes=>{
  try{
   const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true});
   if(pdf.getPageCount()!==1)throw Error();
   const objects=pdf.context.enumerateIndirectObjects();if(objects.length>10000)throw Error();
   const seen=new Set(),denied=new Set(['JS','JavaScript','OpenAction','AA','EmbeddedFiles','Launch','RichMedia','XFA']);
   function visit(value){if(!value||seen.has(value))return;seen.add(value);if(seen.size>20000)throw Error();
    if(value instanceof PDFStream)visit(value.dict);
    else if(value instanceof PDFDict){for(const [key,item]of value.entries()){if(denied.has(key.asString().slice(1)))throw Error();if(item instanceof PDFName&&['JavaScript','Launch','EmbeddedFile','RichMedia'].includes(item.asString().slice(1)))throw Error();visit(item);}}
    else if(value instanceof PDFArray)for(const item of value.asArray())visit(item);
   }
   for(const [,object]of objects)visit(object);
   const {width,height}=pdf.getPage(0).getSize();if(width<=0||height<=0||width>3000||height>20000)throw Error();
  }catch{throw Error('PDF_UNSUPPORTED');}
 };
}
