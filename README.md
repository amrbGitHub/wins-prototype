
### Most Recent Changes 
As of 3/7/2026
- Web app now deploys on Vercel + Render, LLM tunnel to backend using ngrok. LLM still needs to be manually activated because deploying it on cloud is not feasible during the current state of the application. 

- All journal entries are now stored via Supabase to store entries per account and not per browser.

- We can run the LLM with this command on PowerShell: `$env:OLLAMA_HOST="0.0.0.0"; ollama serve`


<img width="1708" height="917" alt="image" src="https://github.com/user-attachments/assets/1bc5a188-1833-459d-a328-77fb723dac1b" />
<img width="1576" height="712" alt="image" src="https://github.com/user-attachments/assets/94cceb57-7ca6-49f6-b506-1078273fb2c6" />


### Main Features that were added

### Older Changes Notes
Replaced Paid Abacus AI with Free Ollama's Llama3.2 (runs locally only, future prototypes will have this deploy on cloud)

Added a 'Work Journal' page that keeps track of all documented wins that happened during the day or a weekly recap
Refactored the main 'Celebrate' page to work alongside with the Work Journal

Improved message generation content

Added persistent browser storage so wins are saved per browser (future prototypes will have this data stored in a database such as Supabase or MongoDB and make it per user instead of per browser)

### Old UI
<img width="1903" height="1007" alt="image" src="https://github.com/user-attachments/assets/ca06ed4d-822a-4b33-a793-20e58aae2cc6" />
<img width="1905" height="882" alt="image" src="https://github.com/user-attachments/assets/3b81c7fc-71a7-4231-851b-e945f80b3004" />

