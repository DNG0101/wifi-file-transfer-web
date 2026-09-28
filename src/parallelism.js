// User-selected lanes include the primary lane. Blocks always equal twice lanes.
export const MIN_LANES=8,DEFAULT_LANES=8,MAX_LANES=50;
export function parallelism(value=DEFAULT_LANES){
 const number=Number(value);
 const lanes=Number.isFinite(number)?Math.min(MAX_LANES,Math.max(MIN_LANES,Math.round(number))):DEFAULT_LANES;
 return {lanes,blocks:lanes*2};
}
export function validateParallelism(value){
 if(!value||!Number.isInteger(value.lanes)||value.lanes<MIN_LANES||value.lanes>MAX_LANES||value.blocks!==value.lanes*2)throw Error('Invalid transfer parallelism.');
 return {lanes:value.lanes,blocks:value.blocks};
}
export function bindParallelism(input,output){
 const render=()=>{const setting=parallelism(input.value);input.value=String(setting.lanes);output.textContent=`${setting.lanes} lanes / ${setting.blocks} blocks`;input.setAttribute('aria-valuetext',output.textContent);return setting;};
 input.min=String(MIN_LANES);input.max=String(MAX_LANES);input.step='1';input.value=String(DEFAULT_LANES);
 input.addEventListener('input',render);render();return render;
}
