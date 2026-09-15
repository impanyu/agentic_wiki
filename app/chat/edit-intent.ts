// Only this user's latest reply can authorize an offered edit; shared discussion cannot.
export function confirmsEditOffer(message:string,conversation:unknown){
 if(!/^(?:好(?:的)?|可以|行|嗯|是的|同意|没问题|請|请|yes|yep|yeah|ok(?:ay)?|sure|please do|go ahead)[!！。．.\s]*$/i.test(message.trim()))return false;
 const context=conversation as {ownConversation?:{turns?:{reply?:string}[]};turns?:{reply?:string}[]}|null;
 const last=(context?.ownConversation?.turns||context?.turns||[]).at(-1)?.reply||'';
 return /(?:我可以|我能|要不要|是否需要|如果你愿意|如果需要)[\s\S]{0,240}(?:修改|改写|改得|改成|更新|补充|加入|添加|删掉|删除|润色|重写)/.test(last)
  || /(?:I can|I could|would you like me to|shall I)[\s\S]{0,200}\b(?:edit|update|revise|rewrite|add|remove|change)\b/i.test(last);
}
