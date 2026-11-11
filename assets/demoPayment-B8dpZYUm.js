var e=e=>`₹${(e/100).toLocaleString(`en-IN`,{maximumFractionDigits:2})}`;function t(t){return new Promise(n=>{let r=document.activeElement,i=document.createElement(`div`);i.className=`fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 px-4`,i.setAttribute(`role`,`dialog`),i.setAttribute(`aria-modal`,`true`),i.setAttribute(`aria-labelledby`,`demo-pay-title`),i.innerHTML=`
      <div class="w-full max-w-sm rounded-[24px] bg-paper p-6 text-center shadow-lift">
        <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-700">Demo payment</p>
        <h2 id="demo-pay-title" class="mt-2 font-display text-3xl">${e(t.amount)}</h2>
        <p class="mt-1 text-sm text-muted"></p>
        <p class="mt-4 rounded-xl bg-blush-50 px-3 py-2 text-[13px] text-ink-soft">This is a demo store. No money will be charged. The live store opens Razorpay (UPI, cards, net banking) here.</p>
        <div class="mt-5 grid gap-2">
          <button type="button" data-pay class="h-12 rounded-full bg-ink text-sm font-medium text-ivory hover:bg-rose-700">Pay ${e(t.amount)} (demo)</button>
          <button type="button" data-cancel class="h-11 rounded-full text-sm text-ink-soft hover:text-rose-700">Cancel</button>
        </div>
      </div>`,i.querySelector(`.text-muted`).textContent=t.description;let a=e=>{document.removeEventListener(`keydown`,o),i.remove(),r?.focus?.(),n(e)},o=e=>{e.key===`Escape`&&a(null)};i.querySelector(`[data-pay]`).addEventListener(`click`,()=>a({razorpay_order_id:t.razorpayOrderId,razorpay_payment_id:`pay_demo_${Math.random().toString(36).slice(2,12)}`,razorpay_signature:`demo`})),i.querySelector(`[data-cancel]`).addEventListener(`click`,()=>a(null)),i.addEventListener(`click`,e=>{e.target===i&&a(null)}),document.addEventListener(`keydown`,o),document.body.appendChild(i),i.querySelector(`[data-pay]`).focus()})}export{t as openDemoPayment};