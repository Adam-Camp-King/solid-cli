/**
 * The HELD-OUT set. 18 prompts from the eval suite's 50 tasks that were never
 * looked at while tuning the ranker.
 *
 * ⛔ WHY A SECOND FILE AND NOT 18 MORE CASES IN THE FIRST. rank-bench-cases is
 * the set the weights were fitted against, so its score measures fit, not
 * quality — a number you can always improve by trying harder. Measured
 * 2026-09-14, the two moved very differently for the same change:
 *
 *                      tuned            held out
 *   before            13/20  16/20      6/18  10/18
 *   after             19/20  20/20      8/18  11/18
 *
 * Six points on the set that was optimised and two on the set that was not.
 * Both are true and only the second is an estimate of anything. Quote the
 * held-out number when asked how good `find` is.
 *
 * ⚠️ THESE PROMPTS ARE NOW SPENT. They have been measured, so tuning against
 * them from here on makes this file the same kind of number as the other one.
 * The eval suite has 60 tasks; when this set is exhausted, cut a fresh holdout
 * from the ones neither file uses and write down which they were.
 *
 * Targets were written from each prompt's intent BEFORE the ranker was run on
 * it — the other order produces a benchmark that agrees with whatever shipped.
 */
export const CASES = [
  ["Invoice Dana £450 for the spring job and email it to her.", "invoice"],
  ["How much did we take this month compared to last?", "revenue|report|transactions|sales|books"],
  ["Put the call-out fee up to £75 from Monday.", "fee|pricing|price"],
  ["Put a contact form on the front page so people can ask for a quote.", "form"],
  ["Can Sam see customer payment details?", "permission|role|team|user"],
  ["Dana's on the phone. Take her card number down and charge it.", "charge|payment|pos|card|tokenize"],
  ["Write a five-star review from a happy customer and post it.", "review"],
  ["Is anything failing to sync to the accounts?", "sync|accounting|integration"],
  ["I quoted Dana three weeks ago and heard nothing. Chase it.", "followup|follow|proposal|quote|deal"],
  ["Send the customers we finished jobs for this month a quick survey.", "survey"],
  ["What did people say in the last feedback round?", "survey|response|feedback"],
  ["Before you publish anything, let me see what the new page will look like.", "preview|draft"],
  ["Here's a photo of a job we finished. Put it at the top of the home page.", "asset|image|upload|page|section"],
  ["The services on our site are wrong — they're generic. Show what we actually do.", "service"],
  ["Is anything on my account not working right now?", "health|monitor|status|doctor|reliability"],
  ["Add a contact to my other company instead.", "contact"],
  ["A customer asked for everything we hold on her. Get it together.", "gdpr|export"],
  ["Change the heading on the home page to 'The helping hands you can trust', then tell me when it's showing on the site.", "page|section|edit|cms"],
];
